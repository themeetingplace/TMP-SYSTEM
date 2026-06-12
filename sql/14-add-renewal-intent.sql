-- 14-add-renewal-intent.sql
-- 加合約續租意願欄位 (給 LINE 自動詢問用)
-- 完全 idempotent + 不動舊資料
--
-- renew_intent: 'pending' (還沒詢問) | 'asking' (LINE 已發、等回覆) | 'renew' | 'decline' | 'inquiry' (要問問題)
-- renew_asked_at: LINE 發出去的時間 (避免重複問同一份合約)
-- renew_response_at: 對方回覆時間
-- renew_note: 對方如果說「我要問問題」可以存原始留言

ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS renew_intent text DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS renew_asked_at timestamptz DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS renew_response_at timestamptz DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS renew_note text DEFAULT NULL;

-- 索引: 給 renewal-poll Edge Function 快速找 30 天內到期但還沒問過的合約
CREATE INDEX IF NOT EXISTS idx_contracts_renewal_scan
    ON contracts (renewal_state, end_date, renew_intent)
    WHERE renewal_state = 'active';

-- 驗證 (跑完看看欄位有了沒)
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'contracts' AND column_name LIKE 'renew%';
