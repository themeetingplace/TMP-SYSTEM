// renewalAskFallback.js
// 登入時提醒 — 不自動發, 只彈 toast 提醒 admin 手動去確認發送
//
// 為什麼不自動: 自動發風險高 (時間點/合約狀態出錯 = 錯訊息直接飛到租客 LINE 沒得救).
//              寧願讓 admin 每次登入看到「有 N 筆該問」→ 主動點按鈕 → 打開勾選 modal → 確認送.
// 觸發時機: app.js bootstrap 完成後 (延遲 5s)

import { mockData } from '../data.js';

const ASK_WINDOW_DAYS = 14;
const COOLDOWN_DAYS = 5;
const SESSION_KEY = 'pms-renewal-ask-prompt-shown';  // 每次 session 只提示一次 (sessionStorage)

export function checkPendingRenewalAsks() {
    // 同一次 tab session 只提示一次 (避免頻繁刷 view 重跳)
    if (sessionStorage.getItem(SESSION_KEY)) return;

    const todayIso = new Date().toISOString().slice(0, 10);
    const cutoff = new Date(Date.now() + ASK_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
    const tenantByName = new Map(mockData.tenants.map(t => [t.name, t]));

    const candidates = mockData.contracts.filter(c => {
        if (c.renewalState !== 'active') return false;
        if (!c.endDate || c.endDate < todayIso || c.endDate > cutoff) return false;
        if (c.contractType && c.contractType !== 'cohousing') return false;
        if (c.bundleParentContractId) return false;
        if (c.renewIntent === 'renew' || c.renewIntent === 'decline') return false;
        const t = tenantByName.get(c.tenant);
        if (!t || !t.lineUserId) return false;
        if (c.renewAskedAt) {
            const askedMs = new Date(c.renewAskedAt).getTime();
            if (Date.now() - askedMs < COOLDOWN_DAYS * 86400000) return false;
        }
        return true;
    });

    if (candidates.length === 0) {
        console.log('[renewalAskPrompt] 沒有待詢問合約');
        sessionStorage.setItem(SESSION_KEY, '1');
        return;
    }

    console.log(`[renewalAskPrompt] 有 ${candidates.length} 筆待詢問:`,
        candidates.map(c => `${c.id} (${c.tenant}, 到期 ${c.endDate})`));

    // 彈一個 sticky toast 提醒, 點擊跳去合約頁 auto-open 勾選 modal
    import('./ui.js').then(({ showToast }) => {
        const toast = showToast(
            `🔔 有 ${candidates.length} 位租客的合約 14 天內到期尚未詢問, 點此前往確認發送`,
            'info',
            15000  // 15 秒
        );
        if (toast && typeof toast === 'object') {
            toast.style.cursor = 'pointer';
            toast.addEventListener('click', () => {
                sessionStorage.setItem(SESSION_KEY, '1');
                // 導向合約管理 + 觸發詢問續租 modal
                if (window.location.hash !== '#contracts') {
                    window.location.hash = 'contracts';
                }
                setTimeout(() => {
                    document.querySelector('#btn-ask-renewal')?.click();
                }, 400);
                toast.remove();
            });
        }
        sessionStorage.setItem(SESSION_KEY, '1');
    });
}
