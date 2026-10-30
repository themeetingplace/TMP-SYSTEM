import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const edge = read('../supabase/functions/tenant-register/index.ts');
const tenants = read('../js/views/tenants.js');
const mapping = read('../js/db-mapping.js');
const dashboard = read('../js/views/dashboard.js');
const migration = read('../sql/40-tenant-id-card-manual-fallback-2026-10-30.sql');

assert.ok(edge.includes('manualIdFallback === true'), 'Edge Function 必須只接受明確的人工補件布林值');
assert.ok(edge.includes("id_card_status: 'pending_admin_upload'"), '人工補件必須寫入待管理員上傳狀態');
assert.ok(edge.includes('id_card_fallback_declared_at'), '人工補件必須保存住客聲明時間');
assert.ok(edge.includes('待管理員補證件'), '管理端訊息紀錄必須標示待補證件');

assert.ok(tenants.includes('uploadTenantIdCard'), '租客詳細資料必須提供後台上傳證件功能');
assert.ok(tenants.includes('watermarkAdminIdCard'), '後台上傳的證件必須先加用途浮水印');
assert.ok(tenants.includes('待管理員補件'), '租客詳細資料必須顯示待補件狀態');
assert.ok(tenants.includes(".from('id-cards')"), '後台證件必須上傳到 private id-cards bucket');

assert.ok(mapping.includes('id_card_status'), '雲端同步 mapping 必須包含證件流程狀態');
assert.ok(mapping.includes('id_card_fallback_declared_at'), '雲端同步 mapping 必須包含人工補件聲明時間');
assert.ok(dashboard.includes('等待管理員補上證件'), '管理首頁通知必須指出待補件登記');
assert.ok(migration.includes("pending_admin_upload"), '資料庫 migration 必須允許待管理員補件狀態');

console.log('ID card manual fallback regression checks passed');
