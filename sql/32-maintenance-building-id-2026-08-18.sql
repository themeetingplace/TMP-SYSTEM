-- ========================================================================
-- 32-maintenance-building-id-2026-08-18.sql
-- 維修單加 building_id: 讓「公共空間報修 (沒對應到特定床位)」也能保留館別。
-- 舊資料 building_id=null, 前端仍可從 property_name 反查館別。
-- (2026-08-18 已用 MCP apply_migration 跑過; 這份是給新專案重建 / 記錄用)
-- ========================================================================

alter table maintenances
  add column if not exists building_id text;

comment on column maintenances.building_id is '館別 (公共空間報修沒有 property_name 時, 用這個保留館別)';
