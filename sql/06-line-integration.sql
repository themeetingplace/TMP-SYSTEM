-- ========================================================================
-- 06-line-integration.sql
-- LINE OA Messaging API 整合所需 schema
-- ========================================================================

-- tenants 加 LINE 相關欄位
ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS line_user_id      text,           -- LINE 平台給的唯一 ID (U + 32 hex)
    ADD COLUMN IF NOT EXISTS line_display_name text,           -- 加好友時取得的暱稱
    ADD COLUMN IF NOT EXISTS line_picture_url  text,           -- 加好友時取得的頭像
    ADD COLUMN IF NOT EXISTS line_bound_at     timestamptz;    -- 綁定時間 (null = 尚未綁定)

-- 索引：依 line_user_id 查 tenant 是常見操作 (webhook 進來時要找對應的人)
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_line_user_id
    ON tenants(line_user_id)
    WHERE line_user_id IS NOT NULL;

-- LINE 訊息 log (debug / 追蹤用，可選)
CREATE TABLE IF NOT EXISTS line_messages (
    id          bigserial PRIMARY KEY,
    tenant_id   text REFERENCES tenants(id) ON DELETE SET NULL,
    line_user_id text,
    direction   text NOT NULL,           -- 'in' (從 LINE 收到) | 'out' (推給 LINE)
    message_type text,                   -- 'text' | 'file' | 'image' | 'sticker' ...
    content     text,                    -- 訊息內容 / 檔名 / sticker id
    raw         jsonb,                   -- 完整 webhook payload (in) 或 push payload (out)
    created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_line_messages_tenant ON line_messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_line_messages_created ON line_messages(created_at DESC);

ALTER TABLE line_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authenticated_all ON line_messages;
CREATE POLICY authenticated_all ON line_messages FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 加進 realtime publication (讓 BMS 即時看到新進訊息) — 重複 ADD 會 error，所以包 DO block
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'line_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE line_messages;
  END IF;
END $$;
