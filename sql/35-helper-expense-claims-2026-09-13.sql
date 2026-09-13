-- ========================================================================
-- 35-helper-expense-claims-2026-09-13.sql
-- 館務報帳：小幫手可依被授權館別送出支出／零用金／代墊報帳，
-- owner/admin 負責核准、退回與撥款。核准時才原子化建立 invoices 正式支出。
-- 發票／收據存於 private expense-receipts bucket，單檔上限 10 MB。
-- ========================================================================

create table if not exists public.expense_claims (
    id                  uuid primary key default gen_random_uuid(),
    building_id         text not null references public.buildings(id) on update cascade on delete restrict,
    expense_date        date not null default current_date,
    category            text not null,
    funding_source      text not null default 'company',
    amount              integer not null check (amount > 0),
    merchant            text,
    description         text,
    receipt_path        text,
    receipt_name        text,
    receipt_mime        text,
    status              text not null default 'submitted',
    submitted_by        uuid not null,
    submitted_by_email  text not null,
    submitted_by_name   text,
    submitted_at        timestamptz not null default now(),
    reviewed_by_email   text,
    reviewed_at         timestamptz,
    review_note         text,
    invoice_id          text references public.invoices(id) on update cascade on delete set null,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    constraint expense_claims_category_check
        check (category in ('daily_supplies', 'cleaning_supplies', 'repair_supplies', 'transport', 'other')),
    constraint expense_claims_funding_check
        check (funding_source in ('company', 'petty_cash', 'personal')),
    constraint expense_claims_status_check
        check (status in ('submitted', 'approved', 'rejected', 'reimbursed')),
    constraint expense_claims_personal_receipt_check
        check (funding_source <> 'personal' or nullif(trim(receipt_path), '') is not null)
);

-- 已先建立過資料表的環境也補上「個人代墊必須附單據」限制。
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.expense_claims'::regclass
      and conname = 'expense_claims_personal_receipt_check'
  ) then
    alter table public.expense_claims
      add constraint expense_claims_personal_receipt_check
      check (funding_source <> 'personal' or nullif(trim(receipt_path), '') is not null);
  end if;
end $$;

create index if not exists expense_claims_building_date_idx
    on public.expense_claims(building_id, expense_date desc);
create index if not exists expense_claims_status_idx
    on public.expense_claims(status, submitted_at desc);
create index if not exists expense_claims_submitter_idx
    on public.expense_claims(submitted_by, submitted_at desc);

create or replace function public.expense_current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select role from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    limit 1
  ), '');
$$;

create or replace function public.expense_allowed_buildings()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array(
    select jsonb_array_elements_text(coalesce(a.allowed_buildings, '[]'::jsonb))
    from public.admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  ), array[]::text[]);
$$;

create or replace function public.expense_is_reviewer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.expense_current_role() in ('owner', 'admin');
$$;

grant execute on function public.expense_current_role() to authenticated;
grant execute on function public.expense_allowed_buildings() to authenticated;
grant execute on function public.expense_is_reviewer() to authenticated;

create or replace function public.prepare_expense_claim()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null or v_email = '' then
    raise exception '尚未登入';
  end if;

  new.submitted_by := auth.uid();
  new.submitted_by_email := v_email;
  select coalesce(nullif(display_name, ''), email)
    into new.submitted_by_name
    from public.admins
    where lower(email) = v_email
    limit 1;
  new.status := 'submitted';
  new.reviewed_by_email := null;
  new.reviewed_at := null;
  new.review_note := null;
  new.invoice_id := null;
  if new.receipt_path is not null and split_part(new.receipt_path, '/', 1) <> auth.uid()::text then
    raise exception '發票路徑必須屬於目前帳號';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists expense_claims_prepare_insert on public.expense_claims;
create trigger expense_claims_prepare_insert
before insert on public.expense_claims
for each row execute function public.prepare_expense_claim();

create or replace function public.touch_expense_claim()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists expense_claims_touch_update on public.expense_claims;
create trigger expense_claims_touch_update
before update on public.expense_claims
for each row execute function public.touch_expense_claim();

alter table public.expense_claims enable row level security;

drop policy if exists expense_claims_select on public.expense_claims;
drop policy if exists expense_claims_insert on public.expense_claims;
drop policy if exists expense_claims_admin_update on public.expense_claims;

create policy expense_claims_select on public.expense_claims
for select to authenticated
using (
  public.expense_is_reviewer()
  or submitted_by = auth.uid()
);

create policy expense_claims_insert on public.expense_claims
for insert to authenticated
with check (
  public.expense_is_reviewer()
  or (
    public.expense_current_role() = 'helper'
    and submitted_by = auth.uid()
    and building_id = any(public.expense_allowed_buildings())
    and status = 'submitted'
    and invoice_id is null
  )
);

-- 不開放直接 update；所有狀態轉換統一走下方 SECURITY DEFINER RPC，
-- 防止前端直接竄改 invoice_id 或跳過審核狀態機。

create or replace function public.review_expense_claim(
  p_claim_id uuid,
  p_action text,
  p_note text default null
)
returns public.expense_claims
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.expense_claims%rowtype;
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_invoice_id text;
  v_type text;
  v_payment_method text;
  v_is_paid boolean;
begin
  if not public.expense_is_reviewer() then
    raise exception '只有 Owner 或 Admin 可審核報帳';
  end if;
  if p_action not in ('approve', 'reject', 'reimburse') then
    raise exception '不支援的審核動作';
  end if;

  select * into v_claim
  from public.expense_claims
  where id = p_claim_id
  for update;
  if not found then raise exception '找不到報帳單'; end if;

  if p_action = 'reject' then
    if v_claim.status <> 'submitted' then raise exception '只有待審核單可退回'; end if;
    update public.expense_claims
       set status = 'rejected', reviewed_by_email = v_email,
           reviewed_at = now(), review_note = nullif(trim(p_note), '')
     where id = p_claim_id
     returning * into v_claim;
    return v_claim;
  end if;

  if p_action = 'approve' then
    if v_claim.status <> 'submitted' then raise exception '只有待審核單可核准'; end if;

    v_type := case v_claim.category
      when 'daily_supplies' then '日用品'
      when 'cleaning_supplies' then '清潔用品'
      when 'repair_supplies' then '維修耗材'
      when 'transport' then '交通費'
      else '其他支出'
    end;
    v_payment_method := case v_claim.funding_source
      when 'petty_cash' then '零用金'
      when 'personal' then '個人代墊'
      else '公司支付'
    end;
    v_is_paid := v_claim.funding_source <> 'personal';

    -- 與現有 INV-### 編號相容，加 transaction lock 避免同時審核撞號。
    perform pg_advisory_xact_lock(hashtext('pms-invoice-id'));
    select 'INV-' || lpad((coalesce(max((substring(id from '^INV-([0-9]+)$'))::integer), 0) + 1)::text, 3, '0')
      into v_invoice_id
      from public.invoices
     where id ~ '^INV-[0-9]+$';

    insert into public.invoices (
      id, direction, building_id, type, amount, due_date, status, paid_date,
      note, bank_verified, discount, paid_amount, payment_method
    ) values (
      v_invoice_id, 'out', v_claim.building_id, v_type, v_claim.amount,
      v_claim.expense_date,
      case when v_is_paid then '已付' else '未付' end,
      case when v_is_paid then v_claim.expense_date else null end,
      concat_ws(' · ', '館務報帳', nullif(v_claim.merchant, ''), nullif(v_claim.description, ''), v_claim.id::text),
      v_is_paid, 0, case when v_is_paid then v_claim.amount else 0 end, v_payment_method
    );

    update public.expense_claims
       set status = 'approved', invoice_id = v_invoice_id,
           reviewed_by_email = v_email, reviewed_at = now(),
           review_note = nullif(trim(p_note), '')
     where id = p_claim_id
     returning * into v_claim;
    return v_claim;
  end if;

  -- reimburse: 僅個人代墊且已核准可標記撥款，同步結清正式支出。
  if v_claim.funding_source <> 'personal' or v_claim.status <> 'approved' or v_claim.invoice_id is null then
    raise exception '只有已核准的個人代墊可標記撥款';
  end if;
  update public.invoices
     set status = '已付', paid_date = current_date, paid_amount = amount,
         bank_verified = true, updated_at = now()
   where id = v_claim.invoice_id;
  update public.expense_claims
     set status = 'reimbursed', reviewed_by_email = v_email,
         reviewed_at = now(), review_note = coalesce(nullif(trim(p_note), ''), review_note)
   where id = p_claim_id
   returning * into v_claim;
  return v_claim;
end;
$$;

revoke all on function public.review_expense_claim(uuid, text, text) from public;
grant execute on function public.review_expense_claim(uuid, text, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'expense-receipts', 'expense-receipts', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists expense_receipts_insert on storage.objects;
drop policy if exists expense_receipts_select on storage.objects;
drop policy if exists expense_receipts_delete on storage.objects;

create policy expense_receipts_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'expense-receipts'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.expense_current_role() in ('owner', 'admin', 'helper')
);

create policy expense_receipts_select on storage.objects
for select to authenticated
using (
  bucket_id = 'expense-receipts'
  and (
    public.expense_is_reviewer()
    or (storage.foldername(name))[1] = auth.uid()::text
  )
);

create policy expense_receipts_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'expense-receipts'
  and (
    public.expense_is_reviewer()
    or (storage.foldername(name))[1] = auth.uid()::text
  )
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'expense_claims'
  ) then
    alter publication supabase_realtime add table public.expense_claims;
  end if;
end $$;

revoke update on public.expense_claims from authenticated;
grant select, insert on public.expense_claims to authenticated;

-- 既有 helper 若有顯式的頁面白名單，加入新的館務報帳頁。
-- allowed_views = [] 本來就代表預設全開，不需要修改。
update public.admins
set allowed_views = allowed_views || '["expenses"]'::jsonb
where role = 'helper'
  and jsonb_array_length(coalesce(allowed_views, '[]'::jsonb)) > 0
  and not coalesce(allowed_views, '[]'::jsonb) @> '["expenses"]'::jsonb;
