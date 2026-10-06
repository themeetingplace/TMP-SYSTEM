import assert from 'node:assert/strict';
import { resolveInvoiceContractPeriod } from '../js/utils/invoicePeriod.js';

const contracts = [
    { id: 'C285', startDate: '2026-08-26', endDate: '2026-09-25' },
    { id: 'C286', startDate: '2026-09-01T00:00:00Z', endDate: '2026-10-01T00:00:00Z' }
];

// 帳單自己的期間最接近該筆帳款，應優先顯示。
assert.deepEqual(
    resolveInvoiceContractPeriod({ contractId: 'C285', periodStart: '2026-09-01', periodEnd: '2026-09-30' }, contracts),
    { start: '2026-09-01', end: '2026-09-30', label: '2026-09-01 ~ 2026-09-30' }
);

// 舊帳單未保存期間時，回查合約資料。
assert.deepEqual(
    resolveInvoiceContractPeriod({ contractId: 'C286' }, contracts),
    { start: '2026-09-01', end: '2026-10-01', label: '2026-09-01 ~ 2026-10-01' }
);

assert.equal(resolveInvoiceContractPeriod({}, contracts).label, '未設定');

console.log('invoice contract period regression checks passed');
