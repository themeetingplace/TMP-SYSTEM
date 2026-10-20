import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDashboardVerificationCandidate } from '../js/utils/dashboardVerification.js';

const contractIds = new Set(['C100']);
const pending = {
    id: 'INV-100',
    contractId: 'C100',
    direction: 'in',
    amount: 9000,
    paidAmount: 0,
    status: '欠繳',
    bankLast5: '12345',
    bankVerified: false
};

assert.equal(isDashboardVerificationCandidate(pending, contractIds), true, '仍欠款且有末五碼時應顯示');
assert.equal(isDashboardVerificationCandidate({ ...pending, paidAmount: 9000, status: '已繳清' }, contractIds), false, '已結清不得卡在首頁');
assert.equal(isDashboardVerificationCandidate({ ...pending, bankVerified: true }, contractIds), false, '已核對不得重複顯示');
assert.equal(isDashboardVerificationCandidate({ ...pending, contractId: 'C404' }, contractIds), false, '所屬合約不存在時不得顯示');
assert.equal(isDashboardVerificationCandidate({ ...pending, contractId: null }, contractIds), true, '舊帳單沒有 contractId 時仍可核對');

const dashboardSource = readFileSync(new URL('../js/views/dashboard.js', import.meta.url), 'utf8');
assert.ok(dashboardSource.includes('class="rp-verify-done"'), '首頁待核對列必須提供已處理按鈕');
assert.ok(dashboardSource.includes('bankLast5: null'), '已處理按鈕必須清除舊末五碼提醒');
assert.ok(dashboardSource.includes('這個操作不會入帳'), '確認視窗必須說明不會自動入帳');

console.log('dashboard bank verification regression checks passed');
