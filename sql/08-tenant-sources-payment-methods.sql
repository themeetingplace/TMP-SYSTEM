-- 顧客來源 + 付款方式：搬出 hardcoded 改成可在系統設定維護
-- 結構跟 invoice_types 同款

CREATE TABLE IF NOT EXISTS tenant_sources (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    note        TEXT,
    updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_methods (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    note        TEXT,
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- RLS：先沿用 invoice_types 的「authenticated_all」模式（之後 phase 4 統一收緊）
ALTER TABLE tenant_sources  ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_all ON tenant_sources;
CREATE POLICY authenticated_all ON tenant_sources FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS authenticated_all ON payment_methods;
CREATE POLICY authenticated_all ON payment_methods FOR ALL TO public USING (true) WITH CHECK (true);

-- 加入 realtime publication
DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE tenant_sources;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE payment_methods;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
END $$;

-- 預設資料
INSERT INTO tenant_sources (id, name) VALUES
    ('TS001', 'Facebook'),
    ('TS002', 'Airbnb'),
    ('TS003', 'LINE'),
    ('TS004', '591'),
    ('TS005', '朋友介紹'),
    ('TS006', '其他')
ON CONFLICT (id) DO NOTHING;

INSERT INTO payment_methods (id, name) VALUES
    ('PM001', '匯款'),
    ('PM002', '現金'),
    ('PM003', '信用卡')
ON CONFLICT (id) DO NOTHING;

-- 既有 tenant.source 舊代碼 → 顯示名稱
UPDATE tenants SET source = 'Facebook' WHERE source = 'fb';
UPDATE tenants SET source = 'Airbnb'   WHERE source = 'airbnb';
UPDATE tenants SET source = 'LINE'     WHERE source = 'line';
UPDATE tenants SET source = '朋友介紹' WHERE source = '介紹';
