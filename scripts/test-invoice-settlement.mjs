import assert from 'node:assert/strict';
import { settlementPreview } from '../js/utils/invoiceSettlement.js';

// C285：應收 9,350，先前已入帳 9,000，本次只需補 350 即全額結清。
const c285 = { amount: 8500, discount: -850, paidAmount: 9000 };
assert.deepEqual(settlementPreview(c285, 350), {
    due: 9350,
    alreadyPaid: 9000,
    receivedThisTime: 350,
    cumulativePaid: 9350,
    outstandingBefore: 350,
    remainingBalance: 0,
    isFullySettled: true
});

// 若本次只再收到 100，拆帳應保存累計 9,100，原帳只留下 250，不能重留 9,250。
assert.deepEqual(settlementPreview(c285, 100), {
    due: 9350,
    alreadyPaid: 9000,
    receivedThisTime: 100,
    cumulativePaid: 9100,
    outstandingBefore: 350,
    remainingBalance: 250,
    isFullySettled: false
});

// 沒有既有入帳時維持原本行為。
assert.deepEqual(settlementPreview({ amount: 1000, discount: 0, paidAmount: 0 }, 400), {
    due: 1000,
    alreadyPaid: 0,
    receivedThisTime: 400,
    cumulativePaid: 400,
    outstandingBefore: 1000,
    remainingBalance: 600,
    isFullySettled: false
});

console.log('invoice settlement regression checks passed');
