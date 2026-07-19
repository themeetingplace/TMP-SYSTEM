// autoRenewalProcessor.js
// LINE 回「續租」→ 自動幫他建續租合約 + apply rentRules → LINE 發繳款通知
// 觸發時機: 每次 sync pull 完 (bms:data-changed source='pull') + app 初次載入
// 保護:
//   - Debounce 5s (避免多次 pull 重覆跑)
//   - 只處理 renewIntent='renew' 且 renewalState='active' (還沒續) 且沒 successor 的
//   - 只跑「已綁 LINE」的租客
//   - 每 run 最多處理 20 筆 (避免瞬間大量 push)

import { mockData, store } from '../data.js';
import { pushToTenant } from './line.js';
import { buildPaymentNoticeMessage } from './paymentNoticeMessage.js';

let lastRunTs = 0;
let running = false;

export function scheduleAutoRenewalProcess(reasonTag = 'sync') {
    // Debounce 5s
    if (Date.now() - lastRunTs < 5000) return;
    if (running) return;
    setTimeout(() => processAutoRenewals(reasonTag).catch(e => console.warn('[autoRenewal]', e)), 500);
}

async function processAutoRenewals(reasonTag) {
    if (running) return;
    running = true;
    lastRunTs = Date.now();
    try {
        // 找有回「續租」且還沒建續租合約的
        const successorSet = new Set(
            mockData.contracts.filter(c => c.parentContractId).map(c => c.parentContractId)
        );
        const candidates = mockData.contracts.filter(c => {
            if (c.renewIntent !== 'renew') return false;
            if (c.renewalState !== 'active') return false; // 已續 (renewed) 或決策完 (declined) 跳過
            if (successorSet.has(c.id)) return false; // 已有後續合約
            if (c.contractType && c.contractType !== 'cohousing') return false;
            if (c.bundleParentContractId) return false;
            // 排除 renew_processed 標記過的 (避免重跑失敗 case 造成 spam)
            if (c._autoRenewalTriedAt) return false;
            return true;
        }).slice(0, 20);

        if (candidates.length === 0) return;
        console.log(`[autoRenewal] ${reasonTag}: 處理 ${candidates.length} 筆已回「續租」的合約`);

        let successCount = 0;
        const failed = [];

        for (const oldC of candidates) {
            const tenant = mockData.tenants.find(t => t.name === oldC.tenant);
            if (!tenant || !tenant.lineUserId) {
                failed.push({ id: oldC.id, tenant: oldC.tenant, reason: '租客未綁 LINE' });
                continue;
            }
            // 建續租合約 (store.renewContract 會自動 markDirty → 排隊 push)
            const r = store.renewContract(oldC.id);
            if (r.error) {
                failed.push({ id: oldC.id, tenant: oldC.tenant, reason: r.error });
                continue;
            }
            const newC = r.newContract;
            const rentInv = mockData.invoices.find(inv =>
                inv.contractId === newC.id && inv.direction === 'in' && inv.type === '房租'
            );
            // ⚠ 一律用合約當下的資料組訊息 (不再吃 rentInv.dueDate 免得吃到舊值)
            const { message } = buildPaymentNoticeMessage(newC, { includeRenewalGreeting: true });

            try {
                await pushToTenant(tenant.id, { message, invoiceId: rentInv?.id });
                // 標 _autoRenewalTriedAt 避免下次再跑 (成功時記時間戳)
                const idx = mockData.contracts.findIndex(c => c.id === oldC.id);
                if (idx >= 0) mockData.contracts[idx]._autoRenewalTriedAt = Date.now();
                successCount++;
                console.log(`[autoRenewal] ✅ ${newC.tenant} (${newC.id}) 繳款通知已發`);
            } catch (e) {
                failed.push({ id: oldC.id, tenant: oldC.tenant, reason: e.message });
                console.warn(`[autoRenewal] ⚠ push failed for ${oldC.tenant}:`, e);
            }
        }

        if (successCount > 0 || failed.length > 0) {
            const { showToast } = await import('./ui.js');
            if (successCount > 0) {
                showToast(`🎉 ${successCount} 位租客已回覆續租, 已自動建立續租合約 + 發送繳款通知`, 'success', 6000);
            }
            if (failed.length > 0) {
                console.warn('[autoRenewal] failed:', failed);
                showToast(`⚠ ${failed.length} 筆自動續租失敗, 請至合約頁手動處理 (見 console)`, 'warning', 6000);
            }
        }
    } finally {
        running = false;
    }
}
