-- 16-helper-role.sql
-- 增加 helper (小幫手) 角色 + 提供 get_my_role() RPC 給前端用
--
-- helper = 唯讀小幫手，只能檢視「物件管理 / 住房一覽 / 租客清單」三個分頁
-- 跟現有 admin / owner / viewer 是同層級 (差別在前端 UI 控制 + 未來可加 RLS)
--
-- 本 SQL 完全 idempotent，不會動到舊資料

-- === 1. 新增 get_my_role() RPC =====================================
-- 回傳當前登入帳號的 role 字串 ('owner' / 'admin' / 'helper' / 'viewer' / NULL)
-- NULL = 沒登入 或 email 不在 admins 白名單
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT role
    FROM admins
    WHERE email = (auth.jwt() ->> 'email')
    LIMIT 1;
$$;

-- 給前端可呼叫
GRANT EXECUTE ON FUNCTION get_my_role() TO anon, authenticated;

-- === 2. (可選) 加 role 欄位的 CHECK constraint (放寬到包含 helper) =====
-- 若你的 admins.role 沒有 CHECK constraint，這段可跳過
-- 若有舊的 CHECK 限制 role IN ('admin','owner','viewer')，要 DROP 再加
DO $$
BEGIN
    -- 嘗試 drop 舊 constraint (名字假設是 admins_role_check)
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'admins_role_check' AND table_name = 'admins'
    ) THEN
        ALTER TABLE admins DROP CONSTRAINT admins_role_check;
    END IF;
    -- 加新的 CHECK (允許 helper)
    ALTER TABLE admins ADD CONSTRAINT admins_role_check
        CHECK (role IN ('owner', 'admin', 'viewer', 'helper'));
EXCEPTION WHEN duplicate_object THEN
    -- 若 constraint 已是新版就跳過
    NULL;
END $$;

-- === 3. 驗證 ============================================================
-- SELECT get_my_role();  -- 當前登入者的角色
-- SELECT email, role FROM admins ORDER BY created_at;
