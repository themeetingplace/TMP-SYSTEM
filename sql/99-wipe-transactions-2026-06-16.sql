-- 2026-06-16: 全部清光交易資料，純空殼
--
-- 保留:
--   * buildings (6 個共居館 B001-B006)
--   * invoice_types / tenant_sources / payment_methods (master data)
--   * contract_templates (合約 PDF 樣板)
--   * admins (帳號)
--
-- 清掉:
--   * properties (床位)
--   * tenants (租客)
--   * contracts (合約)
--   * invoices (帳單)
--   * maintenances (維修工單)
--   * checkins (入住記錄)
--
-- 順序重要 — invoices / properties 參照 contracts，contracts 參照 tenants/properties，
-- 所以從「最末端引用者」往回刪：invoices → maintenances → checkins → properties → contracts → tenants
--
-- 跑完之後務必清 localStorage (見執行步驟說明)，本機快取不清會把舊資料 push 回 Supabase 抵銷掉這次刪除。
-- ⚠️ 一次性 destructive 操作 — 跑之前先在 Supabase SQL Editor 用 BEGIN / ROLLBACK 試一遍。

-- 先看看會刪幾筆 (跑前確認)
SELECT 'invoices' AS table_name, COUNT(*) FROM invoices
UNION ALL SELECT 'maintenances',     COUNT(*) FROM maintenances
UNION ALL SELECT 'checkins',         COUNT(*) FROM checkins
UNION ALL SELECT 'properties',       COUNT(*) FROM properties
UNION ALL SELECT 'contracts',        COUNT(*) FROM contracts
UNION ALL SELECT 'tenants',          COUNT(*) FROM tenants
UNION ALL SELECT 'buildings (保留)', COUNT(*) FROM buildings;

-- ===== 開刪 (從末端往回) =====
BEGIN;

DELETE FROM invoices;
DELETE FROM maintenances;
DELETE FROM checkins;
DELETE FROM properties;
DELETE FROM contracts;
DELETE FROM tenants;

-- 驗收 — 應該全部 0 筆，buildings 還是 6
SELECT 'invoices' AS table_name, COUNT(*) FROM invoices
UNION ALL SELECT 'maintenances',     COUNT(*) FROM maintenances
UNION ALL SELECT 'checkins',         COUNT(*) FROM checkins
UNION ALL SELECT 'properties',       COUNT(*) FROM properties
UNION ALL SELECT 'contracts',        COUNT(*) FROM contracts
UNION ALL SELECT 'tenants',          COUNT(*) FROM tenants
UNION ALL SELECT 'buildings (保留)', COUNT(*) FROM buildings;

-- 看一下 6 個共居館還在
SELECT id, name, base_address, status FROM buildings ORDER BY id;

-- 確認 OK 再 COMMIT；不確定就 ROLLBACK
COMMIT;
-- ROLLBACK;
