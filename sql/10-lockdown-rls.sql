-- ========================================================================
-- 10-lockdown-rls.sql
-- 收緊 RLS：把所有 dev_open_all / TO public 的全開放政策，全部改成 TO authenticated
-- 只有登入過的使用者能讀寫 (anon 全擋)
--
-- ⚠ 跑這份之前確認：
--   1. 已在 Supabase Dashboard 建好至少一個管理員帳號
--   2. BMS 登入流程已經能正常運作
-- 否則跑完會被擋在門外
-- ========================================================================

-- ── 1. 砍掉所有舊政策（dev_open_all + 殘留的 TO public 全開放）──
DROP POLICY IF EXISTS dev_open_all      ON buildings;
DROP POLICY IF EXISTS dev_open_all      ON properties;
DROP POLICY IF EXISTS dev_open_all      ON tenants;
DROP POLICY IF EXISTS dev_open_all      ON contracts;
DROP POLICY IF EXISTS dev_open_all      ON invoices;
DROP POLICY IF EXISTS dev_open_all      ON maintenances;
DROP POLICY IF EXISTS dev_open_all      ON checkins;
DROP POLICY IF EXISTS dev_open_all      ON invoice_types;
DROP POLICY IF EXISTS dev_open_all      ON contract_templates;

DROP POLICY IF EXISTS authenticated_all ON buildings;
DROP POLICY IF EXISTS authenticated_all ON properties;
DROP POLICY IF EXISTS authenticated_all ON tenants;
DROP POLICY IF EXISTS authenticated_all ON contracts;
DROP POLICY IF EXISTS authenticated_all ON invoices;
DROP POLICY IF EXISTS authenticated_all ON maintenances;
DROP POLICY IF EXISTS authenticated_all ON checkins;
DROP POLICY IF EXISTS authenticated_all ON invoice_types;
DROP POLICY IF EXISTS authenticated_all ON contract_templates;
DROP POLICY IF EXISTS authenticated_all ON line_messages;
DROP POLICY IF EXISTS authenticated_all ON tenant_sources;
DROP POLICY IF EXISTS authenticated_all ON payment_methods;

-- ── 2. 統一加上 TO authenticated 政策（已登入才能 CRUD）──
CREATE POLICY auth_all ON buildings          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_all ON properties         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_all ON tenants            FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_all ON contracts          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_all ON invoices           FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_all ON maintenances       FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_all ON checkins           FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_all ON invoice_types      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_all ON contract_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_all ON line_messages      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_all ON tenant_sources     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_all ON payment_methods    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 3. 驗證 (跑完看一下這個 SELECT 結果應該每個 table 都看到 auth_all + TO authenticated)──
SELECT
    schemaname, tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
