import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveTenantBuildingName, tenantNewestFirst } from '../js/utils/tenantList.js';

const tenantsView = readFileSync(new URL('../js/views/tenants.js', import.meta.url), 'utf8');
const dbMapping = readFileSync(new URL('../js/db-mapping.js', import.meta.url), 'utf8');
const dataStore = readFileSync(new URL('../js/data.js', import.meta.url), 'utf8');

assert.ok(tenantsView.includes('.sort(tenantNewestFirst)'), '租客清單必須預設以最新新增優先');
assert.ok(tenantsView.includes('data-building='), '租客列必須帶館別資料供篩選');
assert.ok(tenantsView.includes('data-filter-group="building"'), '租客清單必須提供館別分類篩選');
assert.ok(tenantsView.includes('resolveTenantBuildingName'), '租客館別必須由物件與房屋主檔解析');
assert.ok(dbMapping.includes('createdAt: r.created_at'), '雲端租客建立時間必須映射至前端');
assert.ok(dataStore.includes("createdAt: new Date().toISOString()"), '本機新增租客必須立即記錄建立時間');

const sorted = [
    { id: 'T003', createdAt: '2026-11-01T00:00:00Z' },
    { id: 'T010', createdAt: '2026-11-05T00:00:00Z' },
    { id: 'T002', createdAt: '2026-10-20T00:00:00Z' }
].sort(tenantNewestFirst);
assert.deepEqual(sorted.map(tenant => tenant.id), ['T010', 'T003', 'T002']);

const buildings = [{ id: 'B1', name: '松山館' }, { id: 'B2', name: '中山館' }];
const properties = [{ name: '聚空間 - 松山館 R1-A', buildingId: 'B1' }];
assert.equal(resolveTenantBuildingName({ currentProperty: '聚空間 - 松山館 R1-A' }, { properties, buildings }), '松山館');
assert.equal(resolveTenantBuildingName({ currentProperty: '中山館 R2-B' }, { properties, buildings }), '中山館');
assert.equal(resolveTenantBuildingName({ currentProperty: '' }, { properties, buildings }), '未分類');

console.log('tenant list ordering checks passed');
