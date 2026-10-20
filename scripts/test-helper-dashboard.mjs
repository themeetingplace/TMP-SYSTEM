import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMonthCells, buildPettyCashSnapshot, buildStayEvents } from '../js/utils/helperDashboardData.js';

const helperDashboardSource = readFileSync(new URL('../js/views/helper-dashboard.js', import.meta.url), 'utf8');
assert.match(
    helperDashboardSource,
    /import\s*\{[^}]*escapeHtml\s+as\s+esc\s*,\s*escapeAttr[^}]*\}\s*from\s*['"]\.\.\/utils\/escape\.js['"]/,
    '小幫手首頁使用 escapeAttr 時必須明確匯入，避免渲染整頁中斷'
);
assert.ok(helperDashboardSource.includes("window.__helperViews.includes('dashboard_rent_collection')"), '首頁收租進度必須由獨立小幫手權限控制');
assert.ok(helperDashboardSource.includes("canViewRentCollection() ? `<section class=\"helper-rent-card\""), '未開權限時不應渲染首頁收租進度');

const adminUsersSource = readFileSync(new URL('../js/views/admin-users.js', import.meta.url), 'utf8');
assert.ok(adminUsersSource.includes("key: 'dashboard_rent_collection'"), '帳號管理必須提供首頁收租進度權限');
assert.ok(adminUsersSource.includes('class="helper-feature-chk"'), '首頁功能權限必須可由管理員勾選');

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
