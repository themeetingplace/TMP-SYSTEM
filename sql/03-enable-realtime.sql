-- ========================================================================
-- 03-enable-realtime.sql
-- 啟用 Supabase Realtime — 讓不同電腦 / 分頁能即時收到對方的變更
--
-- Supabase 的 Realtime 是透過 PostgreSQL 邏輯複製 (logical replication) 推送，
-- 需要把要追蹤的表加入 `supabase_realtime` 這個 publication。
--
-- 使用：開 SQL Editor → 貼這份 → Run
-- ========================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE
    buildings,
    properties,
    tenants,
    contracts,
    invoices,
    maintenances,
    checkins,
    invoice_types,
    contract_templates;

-- 驗證：查目前 publication 包含哪些表
-- SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
