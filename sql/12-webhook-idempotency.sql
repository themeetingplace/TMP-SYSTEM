-- ========================================================================
-- 12-webhook-idempotency.sql
-- 給 line_messages 加 webhook_event_id + UNIQUE constraint
-- 配合 line-webhook code 的 P1-3 修正：LINE 重送同事件不會建重複資料
-- ========================================================================

-- 1. 加欄位 (允許 NULL，舊資料沒這欄)
ALTER TABLE line_messages
  ADD COLUMN IF NOT EXISTS webhook_event_id text;

-- 2. UNIQUE constraint — 同 webhookEventId 只允許 1 筆
-- (NULL 不會被 UNIQUE 擋，所以舊資料無痛)
CREATE UNIQUE INDEX IF NOT EXISTS line_messages_webhook_event_id_uniq
  ON line_messages (webhook_event_id)
  WHERE webhook_event_id IS NOT NULL;

-- 3. 驗證
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'line_messages' AND column_name = 'webhook_event_id';
