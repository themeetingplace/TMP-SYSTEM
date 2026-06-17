-- 2026-06-17: 修補 privilege escalation
--
-- 問題: 原本 is_admin() 信任 auth.jwt() -> user_metadata.role = 'admin'
-- 但 user_metadata 是 user-mutable，任何登入的人都可以 client-side 自封:
--   supabase.auth.updateUser({ data: { role: 'admin' } })
-- 自封後就繞過 admins 白名單，直接讀寫 12 張公用表 + storage (含 PII + 身分證)
--
-- 修法: 改成只查 admins 表 (server-side, SECURITY DEFINER)
-- 對齊 sql/16-helper-role.sql get_my_role() 已經有的安全模式

CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM admins
    WHERE lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- 驗證 1: 你自己跑 (應該 true，因為 admins 表有你的 email)
SELECT is_admin() AS am_i_admin, auth.jwt() ->> 'email' AS my_email;

-- 驗證 2: 模擬攻擊者改 user_metadata 自封 admin
-- (跑這段你會看到 user_metadata.role 改成 'admin' 但 is_admin() 仍然只認 admins 表)
SELECT
  is_admin() AS still_safe,
  auth.jwt() -> 'user_metadata' ->> 'role' AS claimed_metadata_role;

-- 注意: CREATE OR REPLACE FUNCTION 會直接覆寫 — 不要 DROP CASCADE
-- (那會把所有引用 is_admin() 的 RLS policy 一起 drop)
-- RLS policies 不用重建，下次呼叫 is_admin() 自動拿到新版

-- 驗證 3: 列 12 張表的 admin policy (確保沒被破壞)
SELECT schemaname, tablename, policyname, cmd
FROM pg_policies
WHERE policyname LIKE 'admin_all_%'
ORDER BY tablename;
