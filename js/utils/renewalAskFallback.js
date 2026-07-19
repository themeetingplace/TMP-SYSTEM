// renewalAskFallback.js
// 客戶端保險 — pg_cron 掛掉時的 fallback:
//   每天第一次開 PMS 自動 trigger renewal-poll (24h debounce via localStorage)
//   只在真的有 pending 候選時才 invoke Edge Function (避免無謂呼叫)
//
// 觸發時機: app.js bootstrap 完成後 (延遲 5s)
// 為什麼要這個: pg_cron 需要手動跑 SQL 才會排, 一次沒設好整年沒發. 前端 fallback
//              保證 admin 有登入的日子就一定會掃

import { mockData } from '../data.js';
import { triggerRenewalPoll } from './line.js';

const STORAGE_KEY = 'pms-renewal-poll-last-trigger';
const DEBOUNCE_MS = 20 * 3600 * 1000;  // 20 小時 (讓每天登入時都能 trigger 一次)
const ASK_WINDOW_DAYS = 14;             // 14 天內到期
const COOLDOWN_DAYS = 5;                // 5 天內問過就跳過 (對齊 renewal-poll)

export async function scheduleRenewalAskFallback() {
    // 20h debounce
    const last = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
    if (Date.now() - last < DEBOUNCE_MS) {
        console.log('[renewalFallback] skip - 20h 內已 trigger 過');
        return;
    }

    // 掃本機資料找候選: active + 14天內到期 + 已綁LINE + 5天內未問過
    const todayIso = new Date().toISOString().slice(0, 10);
    const cutoff = new Date(Date.now() + ASK_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
    const tenantByName = new Map(mockData.tenants.map(t => [t.name, t]));

    const candidates = mockData.contracts.filter(c => {
        if (c.renewalState !== 'active') return false;
        if (!c.endDate || c.endDate < todayIso || c.endDate > cutoff) return false;
        if (c.contractType && c.contractType !== 'cohousing') return false;
        if (c.bundleParentContractId) return false;
        if (c.renewIntent === 'renew' || c.renewIntent === 'decline') return false;
        // 需要租客有綁 LINE
        const t = tenantByName.get(c.tenant);
        if (!t || !t.lineUserId) return false;
        // 5 天內問過就跳過
        if (c.renewAskedAt) {
            const askedMs = new Date(c.renewAskedAt).getTime();
            if (Date.now() - askedMs < COOLDOWN_DAYS * 86400000) return false;
        }
        return true;
    });

    if (candidates.length === 0) {
        console.log('[renewalFallback] 沒有候選, 不 trigger');
        localStorage.setItem(STORAGE_KEY, String(Date.now())); // 也記時間戳, 避免同一天重掃
        return;
    }

    console.log(`[renewalFallback] 找到 ${candidates.length} 筆候選, 呼叫 renewal-poll:`,
        candidates.map(c => `${c.id} (${c.tenant}, 到期 ${c.endDate})`));

    try {
        const result = await triggerRenewalPoll({
            daysAhead: ASK_WINDOW_DAYS,
            contractIds: candidates.map(c => c.id)
        });
        localStorage.setItem(STORAGE_KEY, String(Date.now()));
        const sent = result.sent || 0;
        if (sent > 0) {
            const { showToast } = await import('./ui.js');
            showToast(`🔔 已自動發送 ${sent} 筆續租詢問 (pg_cron fallback)`, 'success', 5000);
        }
        console.log('[renewalFallback] 結果:', result);
    } catch (e) {
        console.error('[renewalFallback] 失敗:', e);
        // 失敗不記時間戳, 下次還會再試
    }
}
