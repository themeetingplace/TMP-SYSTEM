-- 23: 代管合約 schema 擴充 (R4)
-- 用戶 2026-06-17 確認:
--   B2-6: 屋主端委託合約 = 我們跟屋主簽，建檔成系統內合約
--   B2-7: 住客端合約「出租人」欄位可編輯 (我們 / 屋主名義)
--   B2-8: 代管合約 schema 跟共居不同 (分流)
--
-- 設計:
--   contract_type:
--     'cohousing'       — 共居住客合約 (現有，default)
--     'managed-owner'   — 屋主委託合約 (我們是承租方，屋主是出租方)
--     'managed-tenant'  — 代管住客合約 (出租人欄位可填我們 or 屋主)
--   owner_id      — 代管時關聯到 owners.id (cohousing 為 NULL)
--   lessor_name   — 住客合約的「出租人」顯示名稱 (可編輯)
--   building_id   — 代管房子的 building (cohousing 也可填，無強制)

ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS contract_type TEXT NOT NULL DEFAULT 'cohousing'
        CHECK (contract_type IN ('cohousing', 'managed-owner', 'managed-tenant')),
    ADD COLUMN IF NOT EXISTS owner_id      TEXT REFERENCES owners(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS lessor_name   TEXT,
    ADD COLUMN IF NOT EXISTS building_id   TEXT REFERENCES buildings(id) ON DELETE SET NULL;

-- 既有資料 backfill (現有都是共居)
UPDATE contracts SET contract_type = 'cohousing' WHERE contract_type IS NULL;

-- 索引：依 contract_type / owner_id 查詢加速
CREATE INDEX IF NOT EXISTS contracts_contract_type_idx ON contracts (contract_type);
CREATE INDEX IF NOT EXISTS contracts_owner_id_idx      ON contracts (owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contracts_building_id_idx   ON contracts (building_id) WHERE building_id IS NOT NULL;

-- 註解
COMMENT ON COLUMN contracts.contract_type IS '合約類型：cohousing(共居) / managed-owner(屋主委託) / managed-tenant(代管住客)';
COMMENT ON COLUMN contracts.owner_id      IS '代管時關聯到的屋主 (owners.id)';
COMMENT ON COLUMN contracts.lessor_name   IS '住客合約上顯示的出租人名稱 (可填我們公司名或屋主名)';
COMMENT ON COLUMN contracts.building_id   IS '所屬 building (代管房子用，共居可從 property 推回)';
