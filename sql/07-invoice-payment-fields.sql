-- Invoice 收款記錄欄位（參考飯店訂單模型）
-- 設計：把「應收 vs 已收」分開記，不再用 status 字串推斷
--
-- 應收 = amount - discount
-- 已收 = paid_amount
-- status 由兩者比較自動派生

ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS discount NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS discount_reason TEXT,
    ADD COLUMN IF NOT EXISTS paid_amount NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS payment_method TEXT;

-- Backfill：把現有「已繳清」的帳單視為 paid_amount = amount
UPDATE invoices
   SET paid_amount = amount,
       payment_method = COALESCE(payment_method, '匯款')
 WHERE status = '已繳清'
   AND (paid_amount IS NULL OR paid_amount = 0);

-- 「已付」(out direction) 同理
UPDATE invoices
   SET paid_amount = amount,
       payment_method = COALESCE(payment_method, '匯款')
 WHERE status = '已付'
   AND (paid_amount IS NULL OR paid_amount = 0);

-- ⚠ 若有「部分繳款 / 部分支付」status 的歷史資料，paid_amount 無法自動推算
-- (原本 amount 一個欄位混了應收 / 已收概念，無法還原已收多少)
-- 這類資料請執行前手動檢查：
--   SELECT id, status, amount, paid_amount FROM invoices
--    WHERE status IN ('部分繳款', '部分支付') AND (paid_amount IS NULL OR paid_amount = 0);
-- 若數量少，可手動 UPDATE paid_amount = <實收金額>；若不重要可視為「未繳」全部當 0 即可。

-- 補 discount 預設值
UPDATE invoices SET discount = 0 WHERE discount IS NULL;
