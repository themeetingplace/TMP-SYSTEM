// renewalAskFallback.js
// 純掃描函式 — 找出「待詢問續租」的候選合約, 不寫入任何資料, 不發任何訊息.
// 給首頁「續租待處理」卡片用 (2026-07-20: 從 toast 提醒改成常駐卡片,
// 用戶反饋 toast 點掉就消失, 想要一個固定看得到的獨立區域).

import { mockData } from '../data.js';

const ASK_WINDOW_DAYS = 14;
const COOLDOWN_DAYS = 5;

// 共用的「14 天內到期 + 尚未表態 + 非退租中」基礎過濾 (LINE 綁定與否另外判)
function baseAskFilter(c, tenantByName, todayIso, cutoff) {
    if (c.renewalState !== 'active') return false;
    // 已排定退租 (admin 已手動處理過, 只是還沒到生效日) → 不用再問要不要續住,
    // 人家已經確定要走了
    if (c.pendingTerminationDate) return false;
    if (!c.endDate || c.endDate < todayIso || c.endDate > cutoff) return false;
    if (c.contractType && c.contractType !== 'cohousing') return false;
    if (c.bundleParentContractId) return false;
    if (c.renewIntent === 'renew' || c.renewIntent === 'decline') return false;
    return true;
}

// 已綁 LINE 的候選 — 系統可以自動發詢問
export function findRenewalAskCandidates() {
    const todayIso = new Date().toISOString().slice(0, 10);
    const cutoff = new Date(Date.now() + ASK_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
    const tenantByName = new Map(mockData.tenants.map(t => [t.name, t]));

    return mockData.contracts.filter(c => {
        if (!baseAskFilter(c, tenantByName, todayIso, cutoff)) return false;
        const t = tenantByName.get(c.tenant);
        if (!t || !t.lineUserId) return false;
        if (c.renewAskedAt) {
            const askedMs = new Date(c.renewAskedAt).getTime();
            if (Date.now() - askedMs < COOLDOWN_DAYS * 86400000) return false;
        }
        return true;
    });
}

// 沒綁 LINE 的候選 — 系統發不出去, 需要 admin 手動聯絡 (電話/簡訊)
// 之前這批人完全消失在待辦清單裡, 沒有任何提醒 — 這裡補上讓 admin 至少看得到.
export function findRenewalAskCandidatesNoLine() {
    const todayIso = new Date().toISOString().slice(0, 10);
    const cutoff = new Date(Date.now() + ASK_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
    const tenantByName = new Map(mockData.tenants.map(t => [t.name, t]));

    return mockData.contracts.filter(c => {
        if (!baseAskFilter(c, tenantByName, todayIso, cutoff)) return false;
        const t = tenantByName.get(c.tenant);
        return !t || !t.lineUserId;
    });
}
