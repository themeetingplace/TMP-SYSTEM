-- ========================================================================
-- 31-management-leads-2026-08-17.sql
-- 官網「委託管理 / 房屋委託初步評估」表單 → PMS 代管區「委託諮詢」收件桌
--
-- 資料流:
--   官網委託表單 (publishable key, 未登入 = anon 角色)
--     → INSERT 進 management_leads
--   PMS 代管區「委託諮詢」清單 (admin 登入 = authenticated + is_admin())
--     → SELECT 讀清單 / UPDATE 改狀態、寫負責人備註
--
-- 安全:
--   anon 只能 INSERT (不能 SELECT) → 公開網站塞得進來, 但讀不到任何人的諮詢
--   INSERT 強制 status='new' + 內部欄位留空 → 防止匿名亂設狀態/負責人
--   admin 才能讀寫全部
-- 依賴: is_admin() 已在 13-rls-admin-only.sql 建好
-- ========================================================================

create table if not exists management_leads (
  id           uuid        primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- ── 官網表單欄位 (對齊 _src/partials/landlord-form.html) ──
  name            text    not null,       -- 姓名 *
  phone           text,                   -- 聯絡電話 *
  line_id         text,                   -- LINE ID
  email           text,                   -- Email
  area            text,                   -- 房屋所在地區
  property_type   text,                   -- 房屋類型 (公寓/電梯大樓/透天…)
  acreage         numeric,                -- 房屋坪數
  room_count      integer,                -- 房間數
  timing          text,                   -- 預計出租時間
  property_status jsonb   not null default '[]'::jsonb,  -- 目前狀況 (多選): vacant/occupied-self/rented/ending-soon/renovating/other
  services        jsonb   not null default '[]'::jsonb,  -- 希望了解的服務 (多選): lease-management/master-lease/planning/cleanup/renovation/unsure
  main_problem    text,                   -- 最想解決的問題
  message         text,                   -- 備註
  -- ── 內部工作流欄位 (匿名不可設定) ──
  status       text        not null default 'new',  -- new=新 / contacted=已聯繫 / won=成交 / lost=未成交
  handled_by   text,                      -- 負責人
  note         text,                      -- 內部備註
  source       text        not null default 'website'
);

comment on table management_leads is '官網委託管理線上諮詢 → PMS 代管區收件';

create index if not exists idx_management_leads_status_created
  on management_leads (status, created_at desc);

alter table management_leads enable row level security;

-- ── 匿名 (官網訪客) 只能 INSERT 一筆「新諮詢」, 內部欄位不可設 ──
drop policy if exists anon_insert_management_leads on management_leads;
create policy anon_insert_management_leads
  on management_leads
  for insert
  to anon
  with check (
    status = 'new'
    and handled_by is null
    and note is null
    and source = 'website'
    and length(coalesce(name, '')) between 1 and 100
    and length(coalesce(message, '')) <= 2000
  );

-- 登入的 admin 想手動新增也放行 (走 PMS 內部)
drop policy if exists admin_insert_management_leads on management_leads;
create policy admin_insert_management_leads
  on management_leads for insert to authenticated with check (is_admin());

-- ── admin 讀 / 改 / 刪 ──
drop policy if exists admin_select_management_leads on management_leads;
create policy admin_select_management_leads
  on management_leads for select to authenticated using (is_admin());

drop policy if exists admin_update_management_leads on management_leads;
create policy admin_update_management_leads
  on management_leads for update to authenticated using (is_admin()) with check (is_admin());

drop policy if exists admin_delete_management_leads on management_leads;
create policy admin_delete_management_leads
  on management_leads for delete to authenticated using (is_admin());

-- ── updated_at 自動維護 ──
create or replace function touch_management_leads_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_management_leads_updated_at on management_leads;
create trigger trg_management_leads_updated_at
  before update on management_leads
  for each row execute function touch_management_leads_updated_at();

-- ── 驗證 (可選) ──
-- 1) 模擬官網匿名送出 (應成功):
--    set role anon;
--    insert into management_leads (name, phone, services, message)
--      values ('測試房東', '0912345678', '["lease-management"]'::jsonb, '想了解代管服務');
--    reset role;
-- 2) 匿名讀取 (應回 0 筆 / 被擋):
--    set role anon; select * from management_leads; reset role;
