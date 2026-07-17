-- 15-renewal-poll-cron.sql
-- 用 pg_cron + http (pg_net) 每天 09:00 (Asia/Taipei) 自動呼叫 renewal-poll Edge Function
-- → 不用每天手動進 BMS 按按鈕
--
-- 要求:
--   1. Supabase 專案 Dashboard → Database → Extensions 啟用 pg_cron 跟 pg_net
--   2. Edge Function renewal-poll 已部署
--   3. SUPABASE_URL 跟 SUPABASE_SERVICE_ROLE_KEY 替換成你專案的值
--
-- ⚠ 這份 SQL 包含「動態值」(URL / SERVICE_ROLE_KEY)，跑前請先改下方變數
-- ⚠ Asia/Taipei = UTC+8 → 台北 09:00 = UTC 01:00

-- === 1. 啟用必要 extension (可能 Dashboard 已開) =====================================
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- === 2. 把這個 function unschedule 一次 (idempotent: 已存在會先移除再重排) =========
SELECT cron.unschedule('renewal-poll-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'renewal-poll-daily');

-- === 3. 排程 — 每天 UTC 01:00 (= Asia/Taipei 09:00) ===============================
-- ⚠ 請把 <YOUR-PROJECT-REF> 和 <YOUR-SERVICE-ROLE-KEY> 改成你專案的值再執行
-- 找 PROJECT-REF: Dashboard → Project Settings → General → Reference ID
-- 找 SERVICE-ROLE-KEY: Dashboard → Project Settings → API → service_role secret
SELECT cron.schedule(
    'renewal-poll-daily',
    '0 1 * * *',  -- UTC 01:00 (= 09:00 Asia/Taipei) 每天
    $$
    SELECT net.http_post(
        url := 'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/renewal-poll',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer <YOUR-SERVICE-ROLE-KEY>'
        ),
        body := jsonb_build_object('daysAhead', 14)
    );
    $$
);

-- === 4. 驗證 (看排程有沒有進去) ===================================================
-- SELECT jobid, jobname, schedule, command FROM cron.job WHERE jobname = 'renewal-poll-daily';

-- === 5. 看歷史執行記錄 (cron 跑過幾次) ============================================
-- SELECT * FROM cron.job_run_details
--   WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname = 'renewal-poll-daily')
--   ORDER BY start_time DESC LIMIT 10;

-- === 6. 取消排程 (要的話) =========================================================
-- SELECT cron.unschedule('renewal-poll-daily');
