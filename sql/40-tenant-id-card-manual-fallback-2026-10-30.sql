-- AI 證件判讀失敗時，允許住客先完成 LINE 登記並交由管理員補件。
-- id_card_status:
--   missing              尚未有證件，也沒有人工補件聲明
--   pending_admin_upload 住客已將證件交給小編，等待管理員後台上傳
--   uploaded             已有可供管理員查看的證件正面

ALTER TABLE public.tenants
    ADD COLUMN IF NOT EXISTS id_card_status text NOT NULL DEFAULT 'missing',
    ADD COLUMN IF NOT EXISTS id_card_fallback_declared_at timestamptz DEFAULT NULL;

UPDATE public.tenants
SET id_card_status = 'uploaded'
WHERE id_card_front_path IS NOT NULL
  AND id_card_front_path <> ''
  AND id_card_status <> 'uploaded';

ALTER TABLE public.tenants
    DROP CONSTRAINT IF EXISTS tenants_id_card_status_check;

ALTER TABLE public.tenants
    ADD CONSTRAINT tenants_id_card_status_check
    CHECK (id_card_status IN ('missing', 'pending_admin_upload', 'uploaded'));

COMMENT ON COLUMN public.tenants.id_card_status IS
    'Identity document workflow: missing, pending_admin_upload, uploaded';
COMMENT ON COLUMN public.tenants.id_card_fallback_declared_at IS
    'When the tenant declared that AI failed and the document was sent to an admin';
