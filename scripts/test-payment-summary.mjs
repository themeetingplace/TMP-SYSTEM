import assert from 'node:assert/strict';
import {
    contractReceivableSummary,
    invoiceAdjustments,
    invoiceDueAmount,
    latestContractRentInvoice
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

// C285 回歸：合約月租 8,500，加上能源費 500 與多一天 350，最後應收為 9,350。
const c285Summary = contractReceivableSummary({
    monthlyRent: 8500,
    termMonths: 1,
    invoice: {
        amount: 8500,
        discount: -850,
        discountReason: JSON.stringify([
            { kind: 'add', label: '能源費', amount: 500 },
            { kind: 'add', label: '多1天', amount: 350 }
        ])
    }
});
assert.equal(c285Summary.totalAmount, 9350);
assert.equal(c285Summary.monthlyAmount, 9350);
assert.deepEqual(c285Summary.adjustments, [
    { kind: 'add', label: '能源費', amount: 500 },
    { kind: 'add', label: '多1天', amount: 350 }
]);

// 直接調整帳單總額但沒有結構化明細時，也必須採用帳單值並補出差額。
const directAdjustmentSummary = contractReceivableSummary({
    monthlyRent: 8500,
    termMonths: 1,
    invoice: { amount: 9000, discount: 0, discountReason: null }
});
assert.equal(directAdjustmentSummary.totalAmount, 9000);
assert.deepEqual(directAdjustmentSummary.adjustments, [
    { kind: 'add', label: '帳單最後應收調整', amount: 500 }
]);

const c285Invoices = [
    { id: 'INV-485', contractId: 'C285', direction: 'in', type: '房租', amount: 8500, createdAt: '2026-08-26T10:04:53Z' },
    { id: 'INV-594', contractId: 'C285', direction: 'in', type: '房租', amount: 9000, createdAt: '2026-09-28T07:36:38Z' }
];
assert.equal(latestContractRentInvoice(c285Invoices, 'C285')?.id, 'INV-594');

// 沒有帳單的舊資料仍可用月租與期數安全退回計算。
assert.equal(contractReceivableSummary({ monthlyRent: 8500, termMonths: 3 }).totalAmount, 25500);

console.log('payment summary regression checks passed');
