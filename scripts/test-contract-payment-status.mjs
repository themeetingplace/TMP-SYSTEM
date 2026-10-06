import assert from 'node:assert/strict';
import { contractPaymentStatus } from '../js/utils/contractPaymentStatus.js';

const today = '2026-10-06';

assert.equal(contractPaymentStatus('C0', [], today).code, 'none');

const paid = contractPaymentStatus('C1', [
    { id: 'INV-1', contractId: 'C1', direction: 'in', type: '房租', amount: 9000, discount: 0, paidAmount: 9000, dueDate: '2026-10-01' }
], today);
assert.deepEqual({ code: paid.code, due: paid.due, paid: paid.paid, balance: paid.balance }, { code: 'paid', due: 9000, paid: 9000, balance: 0 });

const partial = contractPaymentStatus('C2', [
    { id: 'INV-2', contractId: 'C2', direction: 'in', type: '房租', amount: 9500, discount: 150, paidAmount: 4000, dueDate: '2026-10-01' }
], today);
assert.deepEqual({ code: partial.code, due: partial.due, paid: partial.paid, balance: partial.balance, overdue: partial.overdue }, { code: 'partial', due: 9350, paid: 4000, balance: 5350, overdue: true });

const overdue = contractPaymentStatus('C3', [
    { id: 'INV-3', contractId: 'C3', direction: 'in', type: '房租', amount: 8000, paidAmount: 0, dueDate: '2026-10-05' }
], today);
assert.equal(overdue.code, 'overdue');

const upcoming = contractPaymentStatus('C4', [
    { id: 'INV-4', contractId: 'C4', direction: 'in', type: '房租', amount: 8000, paidAmount: 0, dueDate: '2026-10-07' }
], today);
assert.equal(upcoming.code, 'unpaid');

// 同合約曾有重複舊帳單時只採最新一筆，避免狀態被舊資料誤判。
const latest = contractPaymentStatus('C5', [
    { id: 'INV-5', contractId: 'C5', direction: 'in', type: '房租', amount: 8500, paidAmount: 0, createdAt: '2026-09-01T00:00:00Z' },
    { id: 'INV-8', contractId: 'C5', direction: 'in', type: '房租', amount: 9000, paidAmount: 9000, createdAt: '2026-10-01T00:00:00Z' }
], today);
assert.equal(latest.code, 'paid');
assert.equal(latest.invoice.id, 'INV-8');

console.log('contract payment status regression checks passed');
