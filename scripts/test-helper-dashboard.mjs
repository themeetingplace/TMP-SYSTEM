import assert from 'node:assert/strict';
import { buildMonthCells, buildPettyCashSnapshot, buildStayEvents } from '../js/utils/helperDashboardData.js';

const buildings = [
    { id: 'B1', name: '甲館', status: 'active' },
    { id: 'B2', name: '乙館', status: 'active' }
];
const properties = [
    { name: '甲館 R1-A', buildingId: 'B1', roomNumber: 1, bedLetter: 'A' },
    { name: '甲館 R1-B', buildingId: 'B1', roomNumber: 1, bedLetter: 'B' },
    { name: '乙館 R2-A', buildingId: 'B2' }
];
const contracts = [
    { id: 'C1', tenant: '王小明', propertyName: '甲館 R1-A', startDate: '2026-10-03', endDate: '2026-11-03' },
    { id: 'C1-B', tenant: '王小明', propertyName: '甲館 R1-B', startDate: '2026-10-03', endDate: '2026-11-03', bundleParentContractId: 'C1' },
    { id: 'C2', tenant: '李小華', propertyName: '乙館 R2-A', startDate: '2026-10-04', endDate: '2026-10-29' }
];

const events = buildStayEvents({ contracts, properties, buildingIds: new Set(['B1']), monthKey: '2026-10' });
assert.deepEqual(events.map(e => [e.type, e.date, e.tenant]), [['checkin', '2026-10-03', '王小明']]);
assert.deepEqual(events[0].beds, ['R1-A', 'R1-B']);
assert.deepEqual(events[0].leasePeriods, ['2026-10-03 ～ 2026-11-03']);
assert.equal(buildMonthCells('2026-10').filter(Boolean).length, 31);

const snapshot = buildPettyCashSnapshot({
    buildings,
    buildingIds: new Set(['B1']),
    monthKey: '2026-10',
    claims: [
        { buildingId: 'B1', category: 'petty_cash_income', fundingSource: 'petty_cash', status: 'submitted', expenseDate: '2026-09-30', amount: 3000 },
        { buildingId: 'B1', category: 'daily_supplies', fundingSource: 'petty_cash', status: 'submitted', expenseDate: '2026-10-03', amount: 300 },
        { buildingId: 'B1', category: 'energy', fundingSource: 'personal', status: 'submitted', expenseDate: '2026-10-04', amount: 900 },
        { buildingId: 'B1', category: 'daily_supplies', fundingSource: 'petty_cash', status: 'reimbursed', expenseDate: '2026-09-20', amount: 500 },
        { buildingId: 'B1', category: 'daily_supplies', fundingSource: 'personal', status: 'rejected', expenseDate: '2026-10-04', amount: 700 }
    ]
});
assert.equal(snapshot.monthExpenseTotal, 1200);
assert.equal(snapshot.outstandingPersonal, 900);
assert.equal(snapshot.income, 3000);
assert.equal(snapshot.pettyCashSpent, 800);
assert.equal(snapshot.monthSpent, 300);
assert.equal(snapshot.balance, 2200);

console.log('✓ helper dashboard data tests passed');
