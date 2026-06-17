-- 2026-06-17: 代管模式三張表上雲 (audit critical #3: owners/deposits/settlements 只存 localStorage)
--
-- 問題: 代管模式 Phase 1+3 上線時 mockData.owners/deposits/settlements 只在本機
--   - 換裝置看不到
--   - 清快取直接全失
--   - sync.js TABLES 沒列入 → 永遠不上雲
--
-- 修法: 補 schema + RLS 跟既有表一致

-- ===== owners =====
CREATE TABLE IF NOT EXISTS owners (
    id              text PRIMARY KEY,
    name            text NOT NULL,
    gender          text DEFAULT '',
    phone           text DEFAULT '',
    email           text DEFAULT '',
    line_id         text DEFAULT '',
    source          text DEFAULT '員工面談',     -- 屋主自填 / 員工面談 / 朋友推薦 / 其他
    how_known       text DEFAULT '',              -- Facebook / Google / 朋友介紹 / ...
    how_known_other text DEFAULT '',
    note            text DEFAULT '',
    status          text DEFAULT 'active',        -- pending_review / active / archived
    submitted_at    timestamptz DEFAULT now(),
    reviewed_by     text,                         -- user id (員工面談的就 null)
    reviewed_at     timestamptz,
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS owners_status_idx ON owners(status);

-- ===== deposits (押金 ledger — 房客交 → 我們暫收 → 月結時移交屋主) =====
CREATE TABLE IF NOT EXISTS deposits (
    id                text PRIMARY KEY,
    contract_id       text REFERENCES contracts(id) ON DELETE SET NULL,
    tenant_name       text DEFAULT '',
    property_name     text DEFAULT '',
    building_id       text REFERENCES buildings(id) ON DELETE SET NULL,
    amount            numeric DEFAULT 0,
    holder            text DEFAULT 'pms',        -- 'pms' | 'owner'
    collected_date    date,
    transferred_date  date,                       -- 移交給屋主的日期 (null = 還在我們手上)
    note              text DEFAULT '',
    created_at        timestamptz DEFAULT now(),
    updated_at        timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deposits_building_idx ON deposits(building_id);
CREATE INDEX IF NOT EXISTS deposits_holder_idx ON deposits(holder);

-- ===== settlements (屋主月結算) =====
CREATE TABLE IF NOT EXISTS settlements (
    id                                text PRIMARY KEY,
    owner_id                          text REFERENCES owners(id) ON DELETE SET NULL,
    building_id                       text REFERENCES buildings(id) ON DELETE SET NULL,
    month                             text NOT NULL,                -- YYYY-MM
    items                             jsonb DEFAULT '[]'::jsonb,    -- [{ type, label, amount, breakdown? }]
    owner_receivable                  numeric DEFAULT 0,
    deposit_collected_this_month      numeric DEFAULT 0,
    deposit_transferred_this_month    numeric DEFAULT 0,
    owner_holding_deposit_total       numeric DEFAULT 0,
    status                            text DEFAULT 'draft',         -- draft / sent / settled
    sent_at                           timestamptz,
    created_at                        timestamptz DEFAULT now(),
    updated_at                        timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS settlements_owner_idx ON settlements(owner_id);
CREATE INDEX IF NOT EXISTS settlements_month_idx ON settlements(month);

-- ===== updated_at trigger 共用 =====
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS owners_set_updated_at      ON owners;
DROP TRIGGER IF EXISTS deposits_set_updated_at    ON deposits;
DROP TRIGGER IF EXISTS settlements_set_updated_at ON settlements;

CREATE TRIGGER owners_set_updated_at      BEFORE UPDATE ON owners      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER deposits_set_updated_at    BEFORE UPDATE ON deposits    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER settlements_set_updated_at BEFORE UPDATE ON settlements FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ===== RLS (admin-only，跟其他公用表一致) =====
ALTER TABLE owners      ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposits    ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_all_owners      ON owners;
DROP POLICY IF EXISTS admin_all_deposits    ON deposits;
DROP POLICY IF EXISTS admin_all_settlements ON settlements;

CREATE POLICY admin_all_owners      ON owners      FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY admin_all_deposits    ON deposits    FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY admin_all_settlements ON settlements FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ===== Realtime (跟其他表一致) =====
ALTER PUBLICATION supabase_realtime ADD TABLE owners;
ALTER PUBLICATION supabase_realtime ADD TABLE deposits;
ALTER PUBLICATION supabase_realtime ADD TABLE settlements;

-- ===== 驗證 =====
SELECT 'owners', COUNT(*) FROM owners
UNION ALL SELECT 'deposits', COUNT(*) FROM deposits
UNION ALL SELECT 'settlements', COUNT(*) FROM settlements;

-- 列 3 個 admin policy 確認在
SELECT tablename, policyname
FROM pg_policies
WHERE tablename IN ('owners', 'deposits', 'settlements')
ORDER BY tablename;
