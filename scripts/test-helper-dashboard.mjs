import assert from 'node:assert/strict';
import { buildMonthCells, buildPettyCashSnapshot, buildStayEvents } from '../js/utils/helperDashboardData.js';

const buildings = [
    { id: 'B1', name: '甲館', status: 'active', pettyCashMonthlyBudget: 5000 },
    { id: 'B2', name: '乙館', status: 'active', pettyCashMonthlyBudget: 3000 }
];
const properties = [
    { name: '甲館 R1-A', buildingId: 'B1' },
    { name: '乙館 R2-A', buildingId: 'B2' }
];
const contracts = [
    { id: 'C1', tenant: '王小明', propertyName: '甲館 R1-A', startDate: '2026-10-03', endDate: '2026-11-03' },
    { id: 'C2', tenant: '李小華', propertyName: '乙館 R2-A', startDate: '2026-10-04', endDate: '2026-10-29' }
];

const events = buildStayEvents({ contracts, properties, buildingIds: new Set(['B1']), monthKey: '2026-10' });
assert.deepEqual(events.map(e => [e.type, e.date, e.tenant]), [['checkin', '2026-10-03', '王小明']]);
assert.equal(buildMonthCells('2026-10').filter(Boolean).length, 31);

const snapshot = buildPettyCashSnapshot({
    buildings,
    buildingIds: new Set(['B1']),
    monthKey: '2026-10',
    invoices: [{ buildingId: 'B1', direction: 'out', paymentMethod: '零用金', paidDate: '2026-10-02', amount: 500, paidAmount: 500 }],
    pendingClaims: [{ buildingId: 'B1', fundingSource: 'petty_cash', status: 'submitted', expenseDate: '2026-10-03', amount: 300 }]
});
assert.equal(snapshot.budget, 5000);
assert.equal(snapshot.approved, 500);
assert.equal(snapshot.pending, 300);
assert.equal(snapshot.spent, 800);
assert.equal(snapshot.remaining, 4200);

console.log('✓ helper dashboard data tests passed');
