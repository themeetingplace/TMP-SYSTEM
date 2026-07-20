// autoRenewalProcessor.js
// LINE 回「續租」→ 掃出候選清單, 讓 admin 手動勾選確認才建約+發繳款通知
// (2026-07-19 從「全自動建約」改成「掃描+提醒, 手動確認」— 因為全自動曾造成
//  跟手動建的合約重複衝突, 用戶要求改成跟「詢問續租」一樣的勾選確認模式)
//
// 提供兩個 export:
//   findRenewalConfirmCandidates() — 掃候選 (不寫入任何資料), 給 UI 勾選列表用
//   confirmAndProcessRenewals(contractIds) — 對指定的合約執行建約+發通知 (admin 按確認後呼叫)

import { mockData, store } from '../data.js';
import { pushToTenant } from './line.js';
import { buildPaymentNoticeMessage } from './paymentNoticeMessage.js';

// 找出「已回覆續租但還沒建約」的候選合約
// ⚠ 日期連續性判斷: 同租客+同床位+下一份合約 startDate===這份 endDate 且狀態 active/renewed
//   → 視為已有接續 (不論是不是走 parentContractId 連結建的都算, 防跟手動建的合約重複)
export function findRenewalConfirmCandidates() {
    const successorSet = new Set(
        mockData.contracts.filter(c => c.parentContractId).map(c => c.parentContractId)
    );
    const hasImplicitSuccessor = (c) => mockData.contracts.some(other =>
        other.id !== c.id &&
        other.tenant === c.tenant &&
        other.propertyName === c.propertyName &&
        other.startDate === c.endDate &&
        (other.renewalState === 'active' || other.renewalState === 'renewed')
    );
    return mockData.contracts.filter(c => {
        if (c.renewIntent !== 'renew') return false;
        if (c.renewalState !== 'active') return false;
        if (successorSet.has(c.id)) return false;
        if (hasImplicitSuccessor(c)) return false;
        if (c.contractType && c.contractType !== 'cohousing') return false;
        if (c.bundleParentContractId) return false;
        return true;
    });
}

// 找出「已回覆不續租但還沒處理退租」的合約 (2026-07-20 補上的空隙:
//   以前 decline 回覆完全沒有後續提醒, 系統只記了個 badge 就沒了)
export function findDeclinePendingCandidates() {
    return mockData.contracts.filter(c => {
        if (c.renewIntent !== 'decline') return false;
        if (c.renewalState !== 'active') return false;
        if (c.contractType && c.contractType !== 'cohousing') return false;
        if (c.bundleParentContractId) return false;
        return true;
    });
}

// 對指定的合約 id 陣列執行: 建續租合約 + apply rentRules + 發繳款通知 LINE
// 回傳 { successCount, failed: [{id, tenant, reason}] }
export async function confirmAndProcessRenewals(contractIds) {
    const targets = mockData.contracts.filter(c => contractIds.includes(c.id));
    let successCount = 0;
    const failed = [];

    for (const oldC of targets) {
        const tenant = mockData.tenants.find(t => t.name === oldC.tenant);
        if (!tenant || !tenant.lineUserId) {
            failed.push({ id: oldC.id, tenant: oldC.tenant, reason: '租客未綁 LINE' });
            continue;
        }
        const r = store.renewContract(oldC.id);
        if (r.error) {
            failed.push({ id: oldC.id, tenant: oldC.tenant, reason: r.error });
            continue;
        }
        const newC = r.newContract;
        const rentInv = mockData.invoices.find(inv =>
            inv.contractId === newC.id && inv.direction === 'in' && inv.type === '房租'
        );
        const { message } = buildPaymentNoticeMessage(newC, { includeRenewalGreeting: true });

        try {
            await pushToTenant(tenant.id, { message, invoiceId: rentInv?.id });
            successCount++;
            console.log(`[renewalConfirm] ✅ ${newC.tenant} (${newC.id}) 繳款通知已發`);
        } catch (e) {
            failed.push({ id: oldC.id, tenant: oldC.tenant, reason: e.message });
            console.warn(`[renewalConfirm] ⚠ push failed for ${oldC.tenant}:`, e);
        }
    }

    return { successCount, failed };
}
