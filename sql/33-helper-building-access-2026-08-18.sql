-- ========================================================================
-- 33-helper-building-access-2026-08-18.sql
-- 小幫手 (helper) 可看的館別限制。
--   admins.allowed_buildings = building id 陣列; 空 [] = 看不到任何館。
--   只對 role='helper' 生效; owner/admin 不受限。
--   前端: app.js 登入時呼叫 get_my_allowed_buildings() → window.__helperBuildings,
--         modeFilter 的 currentModeBuildingIdSet 跟 mode 的館取交集, 全站頁面一次生效。
-- (2026-08-18 已用 MCP apply_migration 跑過; 這份是給新專案重建 / 記錄用)
-- ========================================================================

alter table admins
  add column if not exists allowed_buildings jsonb not null default '[]'::jsonb;

comment on column admins.allowed_buildings is '小幫手可檢視的 building id 陣列; 空=看不到任何館; 只對 helper 生效';

-- 回傳當前登入者的 allowed_buildings (找不到回 [])
create or replace function public.get_my_allowed_buildings()
  returns jsonb
  language sql
  security definer
  set search_path to 'public'
as $$
  select coalesce(allowed_buildings, '[]'::jsonb)
  from admins
  where email = (auth.jwt() ->> 'email')
  limit 1;
$$;

grant execute on function public.get_my_allowed_buildings() to authenticated, anon;
