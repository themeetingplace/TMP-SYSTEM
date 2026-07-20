// renewalAskFallback.js
// 純掃描函式 — 找出「待詢問續租」的候選合約, 不寫入任何資料, 不發任何訊息.
// 給首頁「續租待處理」卡片用 (2026-07-20: 從 toast 提醒改成常駐卡片,
// 用戶反饋 toast 點掉就消失, 想要一個固定看得到的獨立區域).

import { mockData } from '../data.js';

const ASK_WINDOW_DAYS = 14;
const COOLDOWN_DAYS = 5;

export function findRenewalAskCandidates() {
    const todayIso = new Date().toISOString().slice(0, 10);
    const cutoff = new Date(Date.now() + ASK_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
    const tenantByName = new Map(mockData.tenants.map(t => [t.name, t]));

    return mockData.contracts.filter(c => {
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
}
