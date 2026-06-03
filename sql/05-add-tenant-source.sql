-- ========================================================================
-- 05-add-tenant-source.sql
-- 租客加上「顧客來源」欄位 (FB / Airbnb / LINE / 其他)
-- ========================================================================

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS source text;

-- 索引：方便之後依來源分析
CREATE INDEX IF NOT EXISTS idx_tenants_source ON tenants (source);
