import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    detectNewTenantRegistrations,
    getDismissedNotificationIds,
    listTenantRegistrationNotifications,
    markNotificationRead
} from '../js/utils/tenantRegistrationNotifications.js';

const now = Date.parse('2026-10-20T12:00:00+08:00');
const tenants = [
    { id: 'T100', name: '新住客', lineBoundAt: '2026-10-20T03:00:00.000Z' },
    { id: 'T099', name: '舊住客', lineBoundAt: '2026-08-01T03:00:00.000Z' },
    { id: 'T098', name: '未綁定', lineBoundAt: null }
];

const recent = listTenantRegistrationNotifications(tenants, { now });
assert.equal(recent.length, 1, '只顯示 30 天內新完成的住客登記');
assert.equal(recent[0].tenant.id, 'T100');

const dismissed = new Set([recent[0].id]);
assert.equal(listTenantRegistrationNotifications(tenants, { now, dismissedIds: dismissed }).length, 0, '已讀通知不可重複顯示');

const detected = detectNewTenantRegistrations(new Set(), tenants, { now });
assert.equal(detected.items.length, 1, '新的 LINE 綁定應被即時偵測');
assert.equal(detectNewTenantRegistrations(detected.currentIds, tenants, { now }).items.length, 0, '相同登記不可重複跳即時通知');

const memory = new Map();
const storage = {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value)
};
markNotificationRead(recent[0].id, storage);
assert.ok(getDismissedNotificationIds(storage).has(recent[0].id), '標示已讀必須保存');

const topbar = readFileSync(new URL('../js/utils/topbar.js', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../js/views/dashboard.js', import.meta.url), 'utf8');
assert.ok(topbar.includes('新住客登記：'), '右上角通知中心必須加入新住客登記');
assert.ok(topbar.includes("window.__currentRole !== 'helper'"), '小幫手不可收到管理端登記通知');
assert.ok(topbar.includes("window.addEventListener('bms:data-changed'"), '新登記必須透過即時資料事件跳通知');
assert.ok(dashboard.includes('tenant-registration-alert'), '管理首頁必須顯示新登記提醒卡');
assert.ok(dashboard.includes('tenant-registration-view'), '首頁通知必須可直接查看住客資料');

console.log('tenant registration notification checks passed');
