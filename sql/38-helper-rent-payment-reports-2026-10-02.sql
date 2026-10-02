-- ========================================================================
-- 小幫手收租回報：回報與正式 invoice 入帳分離。
-- helper 只能操作授權館別；owner/admin 核帳後才由既有房租查帳流程入帳。
-- ========================================================================

create table if not exists public.rent_payment_reports (
  id uuid primary key default gen_random_uuid(),
  invoice_id text not null references public.invoices(id) on update cascade on delete cascade,
  building_id text not null references public.buildings(id) on update cascade on delete restrict,
  amount integer not null check (amount > 0),
  payment_date date not null default current_date,
  payment_method text not null check (payment_method in ('transfer', 'cash_deposit', 'other')),
  note text,
  evidence_path text,
  evidence_name text,
  evidence_mime text,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  submitted_by uuid not null,
  submitted_by_email text not null,
  submitted_by_name text,
  submitted_at timestamptz not null default now(),
  reviewed_by_email text,
  reviewed_at timestamptz,
  review_note text,
  updated_at timestamptz not null default now()
);

create unique index if not exists rent_payment_reports_one_pending_per_invoice
  on public.rent_payment_reports(invoice_id) where status = 'pending';
create index if not exists rent_payment_reports_building_status_idx
  on public.rent_payment_reports(building_id, status, submitted_at desc);

create or replace function public.prepare_rent_payment_report()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_invoice public.invoices%rowtype;
  v_due integer;
  v_paid integer;
begin
  if auth.uid() is null or v_email = '' then raise exception '尚未登入'; end if;
  select * into v_invoice from public.invoices where id = new.invoice_id;
  if not found or v_invoice.direction <> 'in' then raise exception '找不到可回報的應收帳單'; end if;
  if v_invoice.building_id is distinct from new.building_id then raise exception '帳單館別不一致'; end if;
  v_due := greatest(0, coalesce(v_invoice.amount, 0) - coalesce(v_invoice.discount, 0));
  v_paid := greatest(0, coalesce(v_invoice.paid_amount, 0));
  if new.amount > greatest(0, v_due - v_paid) then raise exception '回報金額不可超過帳單尚待收金額'; end if;

  new.submitted_by := auth.uid();
  new.submitted_by_email := v_email;
  select coalesce(nullif(display_name, ''), email) into new.submitted_by_name
    from public.admins where lower(email) = v_email limit 1;
  new.status := 'pending';
  new.reviewed_by_email := null;
  new.reviewed_at := null;
  new.review_note := null;
  if new.evidence_path is not null and split_part(new.evidence_path, '/', 1) <> auth.uid()::text then
    raise exception '付款證明路徑必須屬於目前帳號';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists rent_payment_reports_prepare_insert on public.rent_payment_reports;
create trigger rent_payment_reports_prepare_insert
before insert on public.rent_payment_reports
for each row execute function public.prepare_rent_payment_report();

alter table public.rent_payment_reports enable row level security;
drop policy if exists rent_payment_reports_select on public.rent_payment_reports;
drop policy if exists rent_payment_reports_insert on public.rent_payment_reports;

create policy rent_payment_reports_select on public.rent_payment_reports
for select to authenticated using (
  public.expense_is_reviewer()
  or (public.expense_current_role() = 'helper' and building_id = any(public.expense_allowed_buildings()))
);

create policy rent_payment_reports_insert on public.rent_payment_reports
for insert to authenticated with check (
  public.expense_is_reviewer()
  or (
    public.expense_current_role() = 'helper'
    and submitted_by = auth.uid()
    and building_id = any(public.expense_allowed_buildings())
    and status = 'pending'
  )
);

create or replace function public.review_rent_payment_report(
  p_report_id uuid, p_action text, p_note text default null
)
returns public.rent_payment_reports
language plpgsql security definer set search_path = public
as $$
declare
  v_report public.rent_payment_reports%rowtype;
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if not public.expense_is_reviewer() then raise exception '只有 Owner 或 Admin 可核對收款回報'; end if;
  if p_action not in ('confirm', 'reject') then raise exception '不支援的核帳動作'; end if;
  select * into v_report from public.rent_payment_reports where id = p_report_id for update;
  if not found then raise exception '找不到收款回報'; end if;
  if v_report.status <> 'pending' then raise exception '這筆回報已處理'; end if;
  update public.rent_payment_reports
     set status = case when p_action = 'confirm' then 'confirmed' else 'rejected' end,
         reviewed_by_email = v_email, reviewed_at = now(), review_note = nullif(trim(p_note), ''), updated_at = now()
   where id = p_report_id returning * into v_report;
  return v_report;
end;
$$;
revoke all on function public.review_rent_payment_report(uuid, text, text) from public;
grant execute on function public.review_rent_payment_report(uuid, text, text) to authenticated;

revoke update, delete on public.rent_payment_reports from authenticated;
grant select, insert on public.rent_payment_reports to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rent-payment-proofs', 'rent-payment-proofs', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists rent_payment_proofs_insert on storage.objects;
drop policy if exists rent_payment_proofs_select on storage.objects;
drop policy if exists rent_payment_proofs_delete on storage.objects;
create policy rent_payment_proofs_insert on storage.objects for insert to authenticated
with check (bucket_id = 'rent-payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text
  and public.expense_current_role() in ('owner', 'admin', 'helper'));
create policy rent_payment_proofs_select on storage.objects for select to authenticated
using (bucket_id = 'rent-payment-proofs' and (public.expense_is_reviewer() or (storage.foldername(name))[1] = auth.uid()::text));
create policy rent_payment_proofs_delete on storage.objects for delete to authenticated
using (bucket_id = 'rent-payment-proofs' and (public.expense_is_reviewer() or (storage.foldername(name))[1] = auth.uid()::text));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'rent_payment_reports'
  ) then alter publication supabase_realtime add table public.rent_payment_reports; end if;
end $$;

