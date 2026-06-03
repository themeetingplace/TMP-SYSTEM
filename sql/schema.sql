-- ========================================================================
-- 聚空間 BMS — Supabase Schema v1
-- ========================================================================
-- 使用方式：
--   1. 開啟 Supabase Dashboard → SQL Editor
--   2. 把整份檔案內容貼進去
--   3. 按 RUN
--
-- 注意：
--   * 開頭會 DROP TABLE IF EXISTS … CASCADE，會清掉舊資料
--     （目前 properties 表是空的，所以無損；之後正式上線後不可再跑這份）
--   * 啟用 RLS 但用「dev_open_all」全開放政策，方便開發
--     等 Phase 4 後段接入 auth 再改成有限制的政策
--   * 所有 id 用 text (對應 mockData 的 'B001'/'P001'/'C001' 風格)
--   * camelCase 在 JS 端，snake_case 在 DB 端，supabase-js wrapper 處理轉換
-- ========================================================================

-- ── 清理舊表（順序：FK 依賴的後刪）──
DROP TABLE IF EXISTS contract_templates CASCADE;
DROP TABLE IF EXISTS invoice_types      CASCADE;
DROP TABLE IF EXISTS checkins           CASCADE;
DROP TABLE IF EXISTS maintenances       CASCADE;
DROP TABLE IF EXISTS invoices           CASCADE;
DROP TABLE IF EXISTS contracts          CASCADE;
DROP TABLE IF EXISTS tenants            CASCADE;
DROP TABLE IF EXISTS properties         CASCADE;
DROP TABLE IF EXISTS buildings          CASCADE;

-- ── 共用：updated_at 自動更新觸發器 ──
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ========================================================================
-- 1. buildings  館別主檔
-- ========================================================================
CREATE TABLE buildings (
    id           text PRIMARY KEY,
    name         text NOT NULL,
    base_address text,
    "group"      text,                  -- group 是 SQL 保留字，要用引號
    status       text DEFAULT 'active', -- 'active' | 'inactive'
    note         text,
    created_at   timestamptz DEFAULT now(),
    updated_at   timestamptz DEFAULT now()
);
CREATE TRIGGER trg_buildings_updated_at
    BEFORE UPDATE ON buildings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ========================================================================
-- 2. properties  物件/床位
-- ========================================================================
CREATE TABLE properties (
    id            text PRIMARY KEY,
    building_id   text REFERENCES buildings(id) ON DELETE SET NULL,
    name          text NOT NULL,
    address       text,
    status        text,                 -- '已出租' | '待租' | '待簽約' | '維修中'
    rent          integer,
    tenant        text,                 -- 反正規化的姓名 (UI 顯示用)
    contract_id   text,                 -- 反正規化最近合約 id
    contract_end  date,
    created_at    timestamptz DEFAULT now(),
    updated_at    timestamptz DEFAULT now()
);
CREATE INDEX idx_properties_building_id ON properties(building_id);
CREATE TRIGGER trg_properties_updated_at
    BEFORE UPDATE ON properties
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ========================================================================
-- 3. tenants  租客
-- ========================================================================
CREATE TABLE tenants (
    id                 text PRIMARY KEY,
    name               text NOT NULL,
    phone              text,
    email              text,
    current_property   text,            -- 目前居住的 property name (反正規化)
    status             text,            -- '居住中' | '待入住' | '已退租'
    emergency_contact  text,
    created_at         timestamptz DEFAULT now(),
    updated_at         timestamptz DEFAULT now()
);
CREATE TRIGGER trg_tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ========================================================================
-- 4. contracts  合約
-- ========================================================================
CREATE TABLE contracts (
    id                   text PRIMARY KEY,
    property_id          text REFERENCES properties(id) ON DELETE SET NULL,
    property_name        text,          -- 反正規化（房東報表用）
    tenant               text,          -- 反正規化姓名
    sign_date            date,
    start_date           date,
    end_date             date,
    term_months          integer,       -- 1 或 3
    status               text,          -- '待簽署' | '已簽署' | '已終止'
    amount               integer,       -- 月租金
    deposit_amount       integer DEFAULT 0,
    parent_contract_id   text,          -- 續約時指向上一份
    renewal_state        text DEFAULT 'active',  -- active|renewed|terminated|snoozed
    snooze_until         date,
    signed_file_url      text,
    terminated_date      date,
    decision_taken_at    timestamptz,
    decision_note        text,
    created_at           timestamptz DEFAULT now(),
    updated_at           timestamptz DEFAULT now()
);
CREATE INDEX idx_contracts_property_id ON contracts(property_id);
CREATE INDEX idx_contracts_end_date    ON contracts(end_date);
CREATE INDEX idx_contracts_state       ON contracts(renewal_state);
CREATE TRIGGER trg_contracts_updated_at
    BEFORE UPDATE ON contracts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ========================================================================
-- 5. invoices  帳本（收入 + 支出統一表）
-- ========================================================================
CREATE TABLE invoices (
    id              text PRIMARY KEY,
    contract_id     text REFERENCES contracts(id) ON DELETE SET NULL,
    direction       text NOT NULL,     -- 'in' (收入) | 'out' (支出)
    building_id     text REFERENCES buildings(id) ON DELETE SET NULL,
    property_name   text,
    tenant          text,
    type            text NOT NULL,     -- 對應 invoice_types.name
    amount          integer NOT NULL,
    due_date        date,
    status          text,              -- '已繳清' | '已付' | '欠繳' | '未付'
    paid_date       date,
    period_start    date,
    period_end      date,
    note            text,
    bank_last5      text,              -- 租客回報的匯款末 5 碼
    bank_verified   boolean DEFAULT false,
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_invoices_contract_id ON invoices(contract_id);
CREATE INDEX idx_invoices_building_id ON invoices(building_id);
CREATE INDEX idx_invoices_status      ON invoices(status);
CREATE INDEX idx_invoices_due_date    ON invoices(due_date);
CREATE TRIGGER trg_invoices_updated_at
    BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ========================================================================
-- 6. maintenances  維修
-- ========================================================================
CREATE TABLE maintenances (
    id             text PRIMARY KEY,
    property_name  text,
    issue          text,
    reporter       text,
    report_date    date,
    status         text,              -- '待處理' | '進行中' | '已完成'
    cost           integer,
    created_at     timestamptz DEFAULT now(),
    updated_at     timestamptz DEFAULT now()
);
CREATE TRIGGER trg_maintenances_updated_at
    BEFORE UPDATE ON maintenances
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ========================================================================
-- 7. checkins  入住排程
-- ========================================================================
CREATE TABLE checkins (
    id              text PRIMARY KEY,
    tenant_name     text,
    property_name   text,
    scheduled_date  date,
    status          text,             -- '準備中' | '待確認' | '已完成'
    tasks           jsonb,            -- { contract, deposit, keys, conditionReport }
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now()
);
CREATE TRIGGER trg_checkins_updated_at
    BEFORE UPDATE ON checkins
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ========================================================================
-- 8. invoice_types  帳單類型主檔
-- ========================================================================
CREATE TABLE invoice_types (
    id            text PRIMARY KEY,
    name          text NOT NULL,
    direction     text NOT NULL,      -- 'in' | 'out'
    is_recurring  boolean DEFAULT false,
    note          text,
    created_at    timestamptz DEFAULT now(),
    updated_at    timestamptz DEFAULT now()
);
CREATE TRIGGER trg_invoice_types_updated_at
    BEFORE UPDATE ON invoice_types
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ========================================================================
-- 9. contract_templates  合約 PDF 樣板（每館一份）
-- TODO: pdf_base64 之後改 Supabase Storage bucket 比較省 (現在先求簡單)
-- ========================================================================
CREATE TABLE contract_templates (
    building_id   text PRIMARY KEY REFERENCES buildings(id) ON DELETE CASCADE,
    file_name     text,
    pdf_base64    text,                -- 5MB 以下的 PDF base64 (TOAST 自動處理)
    uploaded_at   timestamptz DEFAULT now(),
    created_at    timestamptz DEFAULT now(),
    updated_at    timestamptz DEFAULT now()
);
CREATE TRIGGER trg_contract_templates_updated_at
    BEFORE UPDATE ON contract_templates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ========================================================================
-- Row Level Security — 開發階段全開放
-- 警告：anon key 任何人有都能讀寫所有資料
-- Phase 4 後段接 auth 時要改成限制政策（例：auth.uid() = owner_id）
-- ========================================================================
ALTER TABLE buildings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants             ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices            ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenances        ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins            ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_types       ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_templates  ENABLE ROW LEVEL SECURITY;

CREATE POLICY dev_open_all ON buildings          FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY dev_open_all ON properties         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY dev_open_all ON tenants            FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY dev_open_all ON contracts          FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY dev_open_all ON invoices           FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY dev_open_all ON maintenances       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY dev_open_all ON checkins           FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY dev_open_all ON invoice_types      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY dev_open_all ON contract_templates FOR ALL USING (true) WITH CHECK (true);

-- ========================================================================
-- 完成。回 Supabase Dashboard → Table Editor 應可看到 9 張表
-- ========================================================================
