-- ========================================================================
-- 13-rls-admin-only.sql  (P0-1)
-- 收緊 RLS：所有資料表只給 admin 帳號讀寫
-- 配合 Supabase Dashboard → Authentication → Email Sign-ups = OFF
--
-- ⚠ 跑這份前確認:
--   1. 你的 admin 帳號 (kowei.chen@gmail.com) 已在 user_metadata.role 設為 'admin'
--   2. 或在 Dashboard → Authentication → Users → 該用戶 → Raw User Meta Data
--      改成: { "role": "admin", "full_name": "..." }
--   3. 之後其他人想用要由你手動 Add User + 設 role
-- ========================================================================

-- ── 移除舊的「all authenticated」全開放政策 ──
DROP POLICY IF EXISTS auth_all_buildings           ON buildings;
DROP POLICY IF EXISTS auth_all_properties          ON properties;
DROP POLICY IF EXISTS auth_all_tenants             ON tenants;
DROP POLICY IF EXISTS auth_all_contracts           ON contracts;
DROP POLICY IF EXISTS auth_all_invoices            ON invoices;
DROP POLICY IF EXISTS auth_all_maintenances        ON maintenances;
DROP POLICY IF EXISTS auth_all_checkins            ON checkins;
DROP POLICY IF EXISTS auth_all_invoice_types       ON invoice_types;
DROP POLICY IF EXISTS auth_all_tenant_sources      ON tenant_sources;
DROP POLICY IF EXISTS auth_all_payment_methods     ON payment_methods;
DROP POLICY IF EXISTS auth_all_contract_templates  ON contract_templates;
DROP POLICY IF EXISTS auth_all_line_messages       ON line_messages;

-- ── helper: 判斷當前 user 是 admin ──
-- 用 user_metadata.role 或 app_metadata.role
CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT
    coalesce(
      (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
      OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
      false
    );
$$;

-- ── 各表的 admin-only policy ──
CREATE POLICY admin_all_buildings           ON buildings           FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY admin_all_properties          ON properties          FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY admin_all_tenants             ON tenants             FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY admin_all_contracts           ON contracts           FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY admin_all_invoices            ON invoices            FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY admin_all_maintenances        ON maintenances        FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY admin_all_checkins            ON checkins            FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY admin_all_invoice_types       ON invoice_types       FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY admin_all_tenant_sources      ON tenant_sources      FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY admin_all_payment_methods     ON payment_methods     FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY admin_all_contract_templates  ON contract_templates  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY admin_all_line_messages       ON line_messages       FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ── 驗證 ──
-- 你登入後跑這段應該看到 1 筆 (確認你的帳號被當 admin)
-- SELECT email, raw_user_meta_data FROM auth.users WHERE email = 'kowei.chen@gmail.com';
--
-- 跑完 policy 後，去 BMS 看資料是否正常顯示 (你是 admin 應該全部能看)
-- 用無痕登入隨便註冊一個帳號 → 應該看不到任何資料
