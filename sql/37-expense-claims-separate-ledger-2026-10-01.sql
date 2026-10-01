-- ========================================================================
-- 37-expense-claims-separate-ledger-2026-10-01.sql
-- 館務報帳改為各館獨立帳：不再建立 invoices；支援能源費、零用金收入、
-- 管理員標示付款，以及管理員／原建立者刪除（前端另有雙重確認）。
-- ========================================================================

alter table public.expense_claims
  drop constraint if exists expense_claims_category_check;
alter table public.expense_claims
  add constraint expense_claims_category_check
  check (category in (
    'energy', 'daily_supplies', 'petty_cash_income',
    'cleaning_supplies', 'repair_supplies', 'transport', 'other'
  ));

-- 小幫手需要看到授權館別的合計與紀錄，但不能越過 allowed_buildings。
drop policy if exists expense_claims_select on public.expense_claims;
create policy expense_claims_select on public.expense_claims
for select to authenticated
using (
  public.expense_is_reviewer()
  or (
    public.expense_current_role() = 'helper'
    and building_id = any(public.expense_allowed_buildings())
  )
);

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
begin
  if not public.expense_is_reviewer() then
    raise exception '只有 Owner 或 Admin 可處理館務報帳';
  end if;
  if p_action not in ('pay', 'reject') then
    raise exception '不支援的處理動作';
  end if;

  select * into v_claim
  from public.expense_claims
  where id = p_claim_id
  for update;
  if not found then raise exception '找不到館務報帳紀錄'; end if;

  if v_claim.status not in ('submitted', 'approved') then
    raise exception '這筆紀錄已處理，無法重複操作';
  end if;

  update public.expense_claims
     set status = case when p_action = 'pay' then 'reimbursed' else 'rejected' end,
         reviewed_by_email = v_email,
         reviewed_at = now(),
         review_note = nullif(trim(p_note), '')
   where id = p_claim_id
   returning * into v_claim;

  -- 刻意不建立或更新 invoices：館務報帳是各館額外報表，不併入主帳務。
  return v_claim;
end;
$$;

revoke all on function public.review_expense_claim(uuid, text, text) from public;
grant execute on function public.review_expense_claim(uuid, text, text) to authenticated;

create or replace function public.delete_expense_claim(p_claim_id uuid)
returns public.expense_claims
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.expense_claims%rowtype;
  v_role text := public.expense_current_role();
begin
  select * into v_claim
  from public.expense_claims
  where id = p_claim_id
  for update;
  if not found then raise exception '找不到館務報帳紀錄'; end if;

  if not public.expense_is_reviewer() and not (
    v_role = 'helper'
    and v_claim.submitted_by = auth.uid()
    and v_claim.building_id = any(public.expense_allowed_buildings())
  ) then
    raise exception '只能刪除自己建立且屬於授權館別的紀錄';
  end if;

  delete from public.expense_claims where id = p_claim_id;
  return v_claim;
end;
$$;

revoke all on function public.delete_expense_claim(uuid) from public;
grant execute on function public.delete_expense_claim(uuid) to authenticated;

revoke update, delete on public.expense_claims from authenticated;
grant select, insert on public.expense_claims to authenticated;

