-- ========================================================================
-- 02-add-property-fields.sql
-- 把 properties 的衍生欄位 (roomNumber/bedLetter/gender/capacity) 補進 schema
-- 這樣 Supabase 才是真正的 source of truth，不依賴 client-side migration
--
-- 使用：
--   1. 開 Supabase SQL Editor
--   2. 貼這份 → RUN
--   3. 回 BMS 跑 await migrateToSupabase() 把現有衍生資料推上去
-- ========================================================================

ALTER TABLE properties
    ADD COLUMN IF NOT EXISTS room_number integer,
    ADD COLUMN IF NOT EXISTS bed_letter  text,
    ADD COLUMN IF NOT EXISTS gender      text,
    ADD COLUMN IF NOT EXISTS capacity    integer;

-- 索引：之後可能會用 building_id + room_number 查同房床位
CREATE INDEX IF NOT EXISTS idx_properties_building_room
    ON properties (building_id, room_number);
