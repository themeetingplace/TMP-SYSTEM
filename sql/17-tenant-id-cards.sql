-- 17-tenant-id-cards.sql
-- 加身分證副本欄位 + 建立 private Storage bucket
--
-- 流程:
--   1. 租客在 LIFF 登記表單上傳身分證正反面照片
--   2. 前端 Canvas 浮水印「僅供聚空間合約使用」
--   3. tenant-register Edge Function 上傳浮水印版到 id-cards bucket
--   4. tenants 表記錄 storage path
--   5. BMS 內 admin 用 signed URL 預覽 (短時效)
--
-- 安全:
--   - bucket 設為 private (RLS 阻止 public access)
--   - 只有 owner / admin 能列 / 讀
--   - 浮水印版本，原圖不存

-- === 1. tenants 加欄位 (idempotent) ===========================
ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS id_card_front_path text DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS id_card_back_path  text DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS id_card_uploaded_at timestamptz DEFAULT NULL;

-- === 2. 建 Storage bucket (private) ===========================
-- ⚠ 若已存在會跳過。bucket name = 'id-cards'
INSERT INTO storage.buckets (id, name, public)
VALUES ('id-cards', 'id-cards', false)
ON CONFLICT (id) DO NOTHING;

-- === 3. Storage RLS — 只允許 admin (含 owner) 讀寫 ============
-- 刪除舊的同名 policy (idempotent)
DROP POLICY IF EXISTS "id_cards_admin_read"  ON storage.objects;
DROP POLICY IF EXISTS "id_cards_admin_write" ON storage.objects;
DROP POLICY IF EXISTS "id_cards_admin_update" ON storage.objects;
DROP POLICY IF EXISTS "id_cards_admin_delete" ON storage.objects;

CREATE POLICY "id_cards_admin_read"
    ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'id-cards' AND is_admin());

CREATE POLICY "id_cards_admin_write"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'id-cards' AND is_admin());

CREATE POLICY "id_cards_admin_update"
    ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'id-cards' AND is_admin());

CREATE POLICY "id_cards_admin_delete"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'id-cards' AND is_admin());

-- === 4. 驗證 ============================================
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'tenants' AND column_name LIKE 'id_card%';
-- SELECT * FROM storage.buckets WHERE id = 'id-cards';
