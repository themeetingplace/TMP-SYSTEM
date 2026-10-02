import assert from 'node:assert/strict';
import { buildRentCollectionRows, rentCollectionCounts, rentCollectionStatusMeta } from '../js/utils/helperRentCollectionData.js';

const rows = buildRentCollectionRows({
    today: '2026-10-02',
    buildingIds: new Set(['B1']),
    buildings: [{ id: 'B1', name: '松山館' }, { id: 'B2', name: '別館' }],
    contracts: [{ id: 'C1', propertyName: '聚空間 - 松山館 R1-A' }],
    invoices: [
        { id: 'I1', contractId: 'C1', buildingId: 'B1', tenant: '甲', direction: 'in', amount: 9000, paidAmount: 0, dueDate: '2026-10-01', status: '欠繳' },
        { id: 'I2', buildingId: 'B1', tenant: '乙', propertyName: '松山館 R2-B', direction: 'in', amount: 8000, paidAmount: 3000, dueDate: '2026-10-05', status: '部分繳款' },
        { id: 'I3', buildingId: 'B1', tenant: '丙', direction: 'in', amount: 7000, paidAmount: 7000, paidDate: '2026-10-02', dueDate: '2026-10-02', status: '已繳清' },
        { id: 'I4', buildingId: 'B2', tenant: '不應顯示', direction: 'in', amount: 1, dueDate: '2026-10-01' }
    ],
    reports: [{ invoiceId: 'I2', amount: 5000, status: 'pending', submittedAt: '2026-10-02T01:00:00Z' }]
});

assert.deepEqual(rows.map(row => [row.id, row.status, row.remaining]), [
    ['I1', 'overdue', 9000],
    ['I2', 'reported', 5000],
    ['I3', 'paid', 0]
]);
assert.equal(rows[0].property, 'R1-A');
assert.deepEqual(rentCollectionCounts(rows), { overdue: 1, due_soon: 0, reported: 1, upcoming: 0, paid: 1 });
assert.equal(rentCollectionStatusMeta('reported').label, '已回報・待核帳');
assert.equal(rentCollectionStatusMeta('overdue').label, '逾期未繳');
console.log('helper rent collection checks passed');
