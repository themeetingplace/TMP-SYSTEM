import assert from 'node:assert/strict';
import {
    invoiceAdjustments,
    invoiceDueAmount
} from '../js/utils/invoicePaymentSummary.js';

// C309 回歸：自動能源費已取消，帳單只保存一筆手動能源費。
// LINE 必須跟帳單一樣是 9,500 + 500 = 10,000，不能再套規則變 10,500。
const cancelledAutoWithManualFee = {
    amount: 9500,
    discount: -500,
    discountReason: JSON.stringify([
        { kind: 'add', label: '能源費', amount: 500 }
    ])
};

assert.equal(invoiceDueAmount(cancelledAutoWithManualFee), 10000);
assert.deepEqual(invoiceAdjustments(cancelledAutoWithManualFee), [
    { kind: 'add', label: '能源費', amount: 500 }
]);

// 未取消的自動能源費也只應保存、顯示一次。
const automaticFee = {
    amount: 9500,
    discount: -500,
    discountReason: JSON.stringify([
        { kind: 'add', label: '能源費 (9月)', amount: 500 }
    ])
};

assert.equal(invoiceDueAmount(automaticFee), 10000);
assert.deepEqual(invoiceAdjustments(automaticFee), [
    { kind: 'add', label: '能源費 (9月)', amount: 500 }
]);

// 舊帳單只有折扣數字、沒有結構化細項時，仍須補出一致的顯示項目。
const legacyAdjustment = {
    amount: 9500,
    discount: -500,
    discountReason: '能源費'
};

assert.equal(invoiceDueAmount(legacyAdjustment), 10000);
assert.deepEqual(invoiceAdjustments(legacyAdjustment), [
    { kind: 'add', label: '能源費', amount: 500 }
]);

console.log('payment summary regression checks passed');
