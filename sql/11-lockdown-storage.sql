-- ========================================================================
-- 11-lockdown-storage.sql
-- 收緊 Storage RLS：合約 PDF 不再公開，只有登入後 (BMS 管理員) 跟 webhook (service_role) 能存取
--
-- ⚠ 跑這份之前先在 Dashboard 把 contract-pdfs bucket 設成 private (取消勾 Public)
--    並順手把已搬到 Netlify 的 liff bucket 整個刪掉
-- ========================================================================

-- ── 移除舊的全開放政策 ──
DROP POLICY IF EXISTS anyone_all_contract_pdfs ON storage.objects;
DROP POLICY IF EXISTS public_all_liff           ON storage.objects;
DROP POLICY IF EXISTS public_read_liff          ON storage.objects;

-- ── 加入「只有登入使用者能存取 contract-pdfs」政策 ──
-- service_role (Edge Function) 自動 bypass RLS，所以 webhook 不受影響
CREATE POLICY auth_all_contract_pdfs ON storage.objects
    FOR ALL TO authenticated
    USING  (bucket_id = 'contract-pdfs')
    WITH CHECK (bucket_id = 'contract-pdfs');

-- ── 驗證：跑完看到 1 條政策即可 ──
SELECT policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;
