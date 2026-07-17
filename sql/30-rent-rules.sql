-- 30-rent-rules.sql
-- 租金加收規則主檔 — 依月份 / 館別自動 apply 加收 or 折扣到新建 invoice
-- 使用: buildContractInvoice → applyRentRules(contract) 掃描規則產生 adjustments
-- amount 正=加收 (夏季能源費), 負=折扣 (冬季優惠)
-- months = INT[] e.g. {6,7,8,9,10}
-- building_ids = TEXT[] 空陣列表示全部館適用

CREATE TABLE IF NOT EXISTS rent_rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    amount NUMERIC NOT NULL DEFAULT 0,
    months INTEGER[] NOT NULL DEFAULT '{}',
    building_ids TEXT[] NOT NULL DEFAULT '{}',
    enabled BOOLEAN DEFAULT TRUE,
    note TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 自動 updated_at trigger (跟其他表一致)
CREATE OR REPLACE FUNCTION update_rent_rules_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rent_rules_updated_at ON rent_rules;
CREATE TRIGGER trg_rent_rules_updated_at
    BEFORE UPDATE ON rent_rules
    FOR EACH ROW EXECUTE FUNCTION update_rent_rules_updated_at();

-- RLS: 只有 admins 表內的人可讀寫
ALTER TABLE rent_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_all ON rent_rules;
CREATE POLICY admin_all ON rent_rules FOR ALL USING (is_admin());

-- 驗證
SELECT 'rent_rules table ready' AS status;
