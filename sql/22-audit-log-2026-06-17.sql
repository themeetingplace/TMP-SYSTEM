-- 2026-06-17: row-level audit_log (audit: 對 contracts/invoices/tenants/buildings destructive 操作有法律級紀錄)
--
-- 用途: 任何 INSERT/UPDATE/DELETE 都記到 audit_log，含
--   - actor email (auth.jwt() ->> 'email')
--   - 表名 / 動作 / row id
--   - before/after JSONB (差異一眼看清)
--   - 時間戳
--
-- 事件後 forensic: SELECT FROM audit_log WHERE row_id = ? ORDER BY changed_at DESC

CREATE TABLE IF NOT EXISTS audit_log (
    id            bigserial PRIMARY KEY,
    table_name    text NOT NULL,
    row_id        text NOT NULL,
    action        text NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
    actor_email   text,                       -- 操作者 (auth.jwt()->>'email')，nullable 應付 service_role 直接改的情況
    actor_role    text,                       -- owner / admin / null
    before_data   jsonb,                      -- DELETE/UPDATE 時 OLD
    after_data    jsonb,                      -- INSERT/UPDATE 時 NEW
    changed_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_table_row_idx ON audit_log(table_name, row_id);
CREATE INDEX IF NOT EXISTS audit_log_changed_at_idx ON audit_log(changed_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log(actor_email);

-- === Trigger function ===
CREATE OR REPLACE FUNCTION audit_log_trigger() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_role  text;
  v_id    text;
BEGIN
  -- 取 jwt 裡的 email (RLS / service_role 都拿得到)
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  IF v_email = '' THEN v_email := NULL; END IF;

  -- 查 actor role
  IF v_email IS NOT NULL THEN
    SELECT role INTO v_role FROM admins WHERE lower(email) = v_email LIMIT 1;
  END IF;

  -- 取 row id (大部分表 pk 叫 id; contract_templates 例外是 building_id 但我們不對它記)
  IF (TG_OP = 'DELETE') THEN
    v_id := COALESCE(OLD.id::text, '');
    INSERT INTO audit_log (table_name, row_id, action, actor_email, actor_role, before_data)
    VALUES (TG_TABLE_NAME, v_id, 'DELETE', v_email, v_role, to_jsonb(OLD));
    RETURN OLD;
  ELSIF (TG_OP = 'UPDATE') THEN
    v_id := COALESCE(NEW.id::text, '');
    INSERT INTO audit_log (table_name, row_id, action, actor_email, actor_role, before_data, after_data)
    VALUES (TG_TABLE_NAME, v_id, 'UPDATE', v_email, v_role, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSE  -- INSERT
    v_id := COALESCE(NEW.id::text, '');
    INSERT INTO audit_log (table_name, row_id, action, actor_email, actor_role, after_data)
    VALUES (TG_TABLE_NAME, v_id, 'INSERT', v_email, v_role, to_jsonb(NEW));
    RETURN NEW;
  END IF;
END;
$$;

-- === 掛到 4 張關鍵表 (contracts / invoices / tenants / buildings) ===
-- DROP 舊 trigger 確保乾淨
DROP TRIGGER IF EXISTS audit_log_contracts  ON contracts;
DROP TRIGGER IF EXISTS audit_log_invoices   ON invoices;
DROP TRIGGER IF EXISTS audit_log_tenants    ON tenants;
DROP TRIGGER IF EXISTS audit_log_buildings  ON buildings;
DROP TRIGGER IF EXISTS audit_log_properties ON properties;
DROP TRIGGER IF EXISTS audit_log_owners     ON owners;

CREATE TRIGGER audit_log_contracts  AFTER INSERT OR UPDATE OR DELETE ON contracts  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();
CREATE TRIGGER audit_log_invoices   AFTER INSERT OR UPDATE OR DELETE ON invoices   FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();
CREATE TRIGGER audit_log_tenants    AFTER INSERT OR UPDATE OR DELETE ON tenants    FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();
CREATE TRIGGER audit_log_buildings  AFTER INSERT OR UPDATE OR DELETE ON buildings  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();
CREATE TRIGGER audit_log_properties AFTER INSERT OR UPDATE OR DELETE ON properties FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();
CREATE TRIGGER audit_log_owners     AFTER INSERT OR UPDATE OR DELETE ON owners     FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

-- === RLS: audit_log 只能讀 (不能改/刪) — admins-only SELECT ===
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_log_select_admins ON audit_log;
CREATE POLICY audit_log_select_admins ON audit_log
    FOR SELECT TO authenticated USING (is_admin());
-- 明確 deny INSERT/UPDATE/DELETE 給 authenticated (只有 trigger 用 SECURITY DEFINER 進得來)
DROP POLICY IF EXISTS audit_log_no_write ON audit_log;
CREATE POLICY audit_log_no_write ON audit_log FOR INSERT TO authenticated WITH CHECK (false);
DROP POLICY IF EXISTS audit_log_no_update ON audit_log;
CREATE POLICY audit_log_no_update ON audit_log FOR UPDATE TO authenticated USING (false);
DROP POLICY IF EXISTS audit_log_no_delete ON audit_log;
CREATE POLICY audit_log_no_delete ON audit_log FOR DELETE TO authenticated USING (false);

-- === 驗收 ===
SELECT 'audit_log triggers' AS what, tablename FROM pg_trigger
    JOIN pg_class c ON c.oid = pg_trigger.tgrelid
    WHERE tgname LIKE 'audit_log_%' AND NOT tgisinternal
    ORDER BY tablename;

-- 最近 10 筆 audit (剛跑完應該空)
SELECT changed_at, table_name, row_id, action, actor_email FROM audit_log ORDER BY changed_at DESC LIMIT 10;
