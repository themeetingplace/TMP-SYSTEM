-- ========================================================================
-- 04-tighten-rls.sql
-- 收緊 RLS：從「全開放」改成「只有已登入使用者能讀寫」
--
-- 必須在 Supabase 已經建好至少一個使用者帳號後再跑，
-- 否則跑完你會被擋在門外（即使在 Dashboard 也是看不到資料）
--
-- 使用：建好使用者後 → SQL Editor → 貼這份 → Run
-- ========================================================================

-- ── 移除舊的 dev_open_all 政策 ──
DROP POLICY IF EXISTS dev_open_all ON buildings;
DROP POLICY IF EXISTS dev_open_all ON properties;
DROP POLICY IF EXISTS dev_open_all ON tenants;
DROP POLICY IF EXISTS dev_open_all ON contracts;
DROP POLICY IF EXISTS dev_open_all ON invoices;
DROP POLICY IF EXISTS dev_open_all ON maintenances;
DROP POLICY IF EXISTS dev_open_all ON checkins;
DROP POLICY IF EXISTS dev_open_all ON invoice_types;
DROP POLICY IF EXISTS dev_open_all ON contract_templates;

-- ── 加入「已登入即可讀寫」政策 (TO authenticated 排除匿名 anon) ──
CREATE POLICY authenticated_all ON buildings          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY authenticated_all ON properties         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY authenticated_all ON tenants            FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY authenticated_all ON contracts          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY authenticated_all ON invoices           FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY authenticated_all ON maintenances       FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY authenticated_all ON checkins           FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY authenticated_all ON invoice_types      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY authenticated_all ON contract_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 之後若要更細：可改成
--   USING (auth.uid() = owner_id)         僅本人可改
--   USING (auth.jwt() ->> 'role' = 'admin')  僅 admin 可改
-- 等等
