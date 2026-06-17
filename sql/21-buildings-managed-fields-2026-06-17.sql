-- 2026-06-17: buildings 表補代管 / 房屋資料 欄位
--
-- 問題: db-mapping.js toDb.building 只有 (id, name, base_address, group, status, note)
-- 代管模式 (mode='managed' + ownerId + 起迄日 + 收費方式...) + 共居房屋資料 (layout/坪數/月租...)
-- 上傳時 sync.js upsert 把缺的欄位 strip 掉 → 手機 pull 回來只看到基本欄位
-- → sidebar.mode === 'managed' filter 抓不到 → 代管房屋不出現
--
-- 修法: ALTER TABLE 加缺的欄位，全部 nullable，不影響既有 6 個共居館

ALTER TABLE buildings
    ADD COLUMN IF NOT EXISTS mode              text     DEFAULT 'cohousing',
    ADD COLUMN IF NOT EXISTS owner_id          text     REFERENCES owners(id) ON DELETE SET NULL,
    -- 房屋資料 (共居 + 代管 共用)
    ADD COLUMN IF NOT EXISTS layout            text,                          -- 原始格局 例 3房2廳1衛
    ADD COLUMN IF NOT EXISTS area_size         numeric,                       -- 坪數
    ADD COLUMN IF NOT EXISTS monthly_rent      numeric,                       -- 月租金
    ADD COLUMN IF NOT EXISTS rent_includes_tax boolean  DEFAULT false,        -- 含稅
    ADD COLUMN IF NOT EXISTS rent_term         text,                          -- 押二付一 等
    ADD COLUMN IF NOT EXISTS tax_reported      boolean  DEFAULT false,
    -- 代管專屬
    ADD COLUMN IF NOT EXISTS developer         text,                          -- 開發人
    ADD COLUMN IF NOT EXISTS manager           text,                          -- 管理人
    ADD COLUMN IF NOT EXISTS managed_start_date date,
    ADD COLUMN IF NOT EXISTS managed_end_date   date,
    ADD COLUMN IF NOT EXISTS fee_type           text     DEFAULT 'fixed',     -- fixed/percent/tier/other
    ADD COLUMN IF NOT EXISTS fee_config         jsonb    DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS energy_mode        text,                          -- owner/tenant/mixed
    -- 共居房屋資料的屋主 inline 欄位 (共居 不用 owner_id, 直接存)
    ADD COLUMN IF NOT EXISTS owner_name         text     DEFAULT '',
    ADD COLUMN IF NOT EXISTS owner_gender       text     DEFAULT '',
    ADD COLUMN IF NOT EXISTS owner_phone        text     DEFAULT '',
    ADD COLUMN IF NOT EXISTS owner_email        text     DEFAULT '',
    ADD COLUMN IF NOT EXISTS owner_line_id      text     DEFAULT '';

-- 既有 6 個共居館回填 mode='cohousing' (前面 hydrate migration 已經處理，但 SQL 層面也補一下)
UPDATE buildings SET mode = 'cohousing' WHERE mode IS NULL OR mode = '';

-- 索引: mode (sidebar filter 用)
CREATE INDEX IF NOT EXISTS buildings_mode_idx ON buildings(mode);
CREATE INDEX IF NOT EXISTS buildings_owner_idx ON buildings(owner_id);

-- 驗收: 看現有 buildings 的 mode 分布
SELECT mode, COUNT(*) FROM buildings GROUP BY mode;
-- 列代管 buildings (應該空，因為手機看不到的那筆 mode 是 NULL → 已被回填成 cohousing 看不到了 — 這是預期)
SELECT id, name, mode, owner_id, monthly_rent FROM buildings WHERE mode = 'managed' ORDER BY id;
