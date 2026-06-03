-- 5/27 上線前健檢 — 在 Supabase SQL Editor 一條一條跑，看每個結果
-- 預期結果都應該是 0 筆或符合預期；任何異常都要在 5/26 內處理掉

-- ════════════════════════════════════════════
-- 1. 租客資料完整性
-- ════════════════════════════════════════════

-- 1a. 有 active 合約但沒填 phone 的租客 (這些人無法綁 LINE)
SELECT t.id, t.name, t.phone, t.status, c.id AS contract_id, c.end_date
  FROM tenants t
  JOIN contracts c ON c.tenant = t.name
 WHERE (t.phone IS NULL OR t.phone = '')
   AND c.renewal_state = 'active'
   AND c.end_date >= CURRENT_DATE;
-- 預期：0 筆。若有 → BMS 租客頁補 phone

-- 1b. 同電話號碼重複的租客 (綁定會綁到第一個，可能造成誤綁)
SELECT phone, COUNT(*) AS dup_count, ARRAY_AGG(name) AS names
  FROM tenants
 WHERE phone IS NOT NULL AND phone != ''
 GROUP BY phone
HAVING COUNT(*) > 1;
-- 預期：0 筆。若有 → 合併或刪除重複

-- 1c. 已綁定 LINE 的租客數量 (用來追蹤綁定進度)
SELECT
    COUNT(*) FILTER (WHERE line_user_id IS NOT NULL) AS bound,
    COUNT(*) FILTER (WHERE line_user_id IS NULL AND status = '居住中') AS unbound_active,
    COUNT(*) AS total
  FROM tenants;
-- 上線後追蹤這個數字，看綁定率

-- ════════════════════════════════════════════
-- 2. 合約 / 帳單對應
-- ════════════════════════════════════════════

-- 2a. active 合約但沒有對應的「房租」invoice
SELECT c.id, c.tenant, c.property_name, c.start_date, c.end_date, c.amount
  FROM contracts c
  LEFT JOIN invoices i
    ON i.contract_id = c.id
   AND i.type = '房租'
   AND i.direction = 'in'
 WHERE c.renewal_state = 'active'
   AND c.end_date >= CURRENT_DATE
   AND i.id IS NULL;
-- 預期：0 筆。若有 → BMS 房租查帳 → 點「補產缺帳單」

-- 2b. invoice status 跟 paid_amount 不一致 (P0 修完後不應再有)
SELECT id, tenant, type, amount, discount, paid_amount, status,
       (amount - COALESCE(discount, 0)) AS net_due,
       CASE
         WHEN (amount - COALESCE(discount, 0)) <= 0 THEN '應已繳清'
         WHEN COALESCE(paid_amount, 0) >= (amount - COALESCE(discount, 0)) THEN '應已繳清'
         WHEN COALESCE(paid_amount, 0) > 0 THEN '應部分繳款'
         ELSE '應欠繳'
       END AS expected_status
  FROM invoices
 WHERE direction = 'in'
   AND status NOT IN (
       CASE
         WHEN (amount - COALESCE(discount, 0)) <= 0 THEN '已繳清'
         WHEN COALESCE(paid_amount, 0) >= (amount - COALESCE(discount, 0)) THEN '已繳清'
         WHEN COALESCE(paid_amount, 0) > 0 THEN '部分繳款'
         ELSE '欠繳'
       END
   );
-- 預期：0 筆。若有 → 點該 invoice「編輯」→ 儲存（會自動 re-derive status）

-- ════════════════════════════════════════════
-- 3. LINE webhook 健康度
-- ════════════════════════════════════════════

-- 3a. 過去 24h webhook 收到的訊息數
SELECT
    DATE_TRUNC('hour', created_at) AS hour,
    COUNT(*) AS msg_count
  FROM line_messages
 WHERE created_at >= NOW() - INTERVAL '24 hours'
 GROUP BY 1
 ORDER BY 1 DESC;
-- 看活躍度。0 訊息 + 應該有 = webhook 可能斷了

-- 3b. 過去 7 天有沒有「綁定失敗」訊息 (找不到此手機號碼)
SELECT created_at, line_user_id, content
  FROM line_messages
 WHERE created_at >= NOW() - INTERVAL '7 days'
   AND message_type = 'text'
   AND content ~ '^09\d{8}$'  -- 純手機號訊息
 ORDER BY created_at DESC
 LIMIT 50;
-- 看有沒有人輸入手機但沒綁成功（cross-check tenants 表）

-- ════════════════════════════════════════════
-- 4. Edge Function Secrets 健檢 (人工檢查)
-- ════════════════════════════════════════════
-- ⚠ 以下需到 Supabase Dashboard → Edge Functions → Secrets 確認：
--   ✅ LINE_CHANNEL_SECRET        (32 字元 hex)
--   ✅ LINE_CHANNEL_ACCESS_TOKEN  (170+ 字元長 token)
--   ✅ ADMIN_LINE_USER_IDS        (U 開頭 33 字元，多個用逗號分隔，無空格)
--   ✅ SUPABASE_URL               (自動帶，https://xxx.supabase.co)
--   ✅ SUPABASE_SERVICE_ROLE_KEY  (自動帶，eyJ... JWT)
