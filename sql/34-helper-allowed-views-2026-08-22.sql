-- ========================================================================
-- 34-helper-allowed-views-2026-08-22.sql
-- 小幫手「頁面權限」— 每個 helper 可個別勾選能看哪些頁面。
--   admins.allowed_views = view keys 陣列; 空 [] = 沿用預設全部小幫手頁面 (向下相容)。
--   view keys: dashboard / occupancy(住房一覽含物件) / contracts / unsettled / maintenance / tenants
--   只對 role='helper' 生效; owner/admin 不受限。
--   前端: app.js boot 呼叫 get_my_allowed_views() → applyHelperViews() 收窄
--         HELPER_ALLOWED (nav 隱藏 + 路由守衛 + 落地頁)。
-- (2026-08-22 已用 MCP apply_migration 跑過; 這份給新專案重建 / 記錄用)
-- ========================================================================

alter table admins
  add column if not exists allowed_views jsonb not null default '[]'::jsonb;

comment on column admins.allowed_views is '小幫手可檢視的頁面 keys 陣列; 空=預設全部; 只對 helper 生效';

create or replace function public.get_my_allowed_views()
  returns jsonb
  language sql
  security definer
  set search_path to 'public'
as $$
  select coalesce(allowed_views, '[]'::jsonb)
  from admins
  where email = (auth.jwt() ->> 'email')
  limit 1;
$$;

grant execute on function public.get_my_allowed_views() to authenticated, anon;
