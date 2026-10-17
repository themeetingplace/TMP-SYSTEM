-- ========================================================================
-- 39-expense-claim-review-workflow-2026-10-17.sql
-- 館務報帳拆成「待審核 → 待處理 → 已完成」，並保存最後處理方式：
-- 已付款、從房費扣除、零用金支出、收入確認。
-- ========================================================================

alter table public.expense_claims
  add column if not exists settlement_method text;

-- 舊的已完成資料依原付款來源補上可辨識的處理方式。
update public.expense_claims
set settlement_method = case
  when category = 'petty_cash_income' then 'income_confirmed'
  when funding_source = 'petty_cash' then 'petty_cash'
  else 'paid'
end
where status = 'reimbursed'
  and settlement_method is null;

alter table public.expense_claims
  drop constraint if exists expense_claims_settlement_method_check;
alter table public.expense_claims
  add constraint expense_claims_settlement_method_check
  check (settlement_method is null or settlement_method in (
    'paid', 'rent_deduction', 'petty_cash', 'income_confirmed'
  ));

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
  v_method text;
begin
  if not public.expense_is_reviewer() then
    raise exception '只有 Owner 或 Admin 可處理館務報帳';
  end if;
  if p_action not in ('approve', 'reject', 'pay', 'rent_deduction', 'confirm') then
    raise exception '不支援的處理動作';
  end if;

  select * into v_claim
  from public.expense_claims
  where id = p_claim_id
  for update;
  if not found then raise exception '找不到館務報帳紀錄'; end if;

  if p_action = 'reject' then
    if v_claim.status not in ('submitted', 'approved') then
      raise exception '只有待審核或待處理的紀錄可以退回';
    end if;
    update public.expense_claims
       set status = 'rejected', settlement_method = null,
           reviewed_by_email = v_email, reviewed_at = now(),
           review_note = nullif(trim(p_note), '')
     where id = p_claim_id
     returning * into v_claim;
    return v_claim;
  end if;

  if p_action = 'approve' then
    if v_claim.status <> 'submitted' then
      raise exception '只有待審核紀錄可以審核通過';
    end if;
    update public.expense_claims
       set status = 'approved', settlement_method = null,
           reviewed_by_email = v_email, reviewed_at = now(),
           review_note = nullif(trim(p_note), '')
     where id = p_claim_id
     returning * into v_claim;
    return v_claim;
  end if;

  if v_claim.status <> 'approved' then
    raise exception '請先審核通過，再選擇請款處理方式';
  end if;

  if p_action = 'rent_deduction' then
    if v_claim.funding_source <> 'personal' or v_claim.category = 'petty_cash_income' then
      raise exception '只有個人代墊支出可以從房費扣除';
    end if;
    v_method := 'rent_deduction';
  elsif p_action = 'pay' then
    if v_claim.category = 'petty_cash_income' or v_claim.funding_source = 'petty_cash' then
      raise exception '這筆紀錄不適用已付款處理';
    end if;
    v_method := 'paid';
  else
    if v_claim.category = 'petty_cash_income' then
      v_method := 'income_confirmed';
    elsif v_claim.funding_source = 'petty_cash' then
      v_method := 'petty_cash';
    else
      raise exception '這筆紀錄請選擇已付款或從房費扣除';
    end if;
  end if;

  update public.expense_claims
     set status = 'reimbursed', settlement_method = v_method,
         reviewed_by_email = v_email, reviewed_at = now(),
         review_note = coalesce(nullif(trim(p_note), ''), review_note)
   where id = p_claim_id
   returning * into v_claim;
  return v_claim;
end;
$$;

revoke all on function public.review_expense_claim(uuid, text, text) from public;
grant execute on function public.review_expense_claim(uuid, text, text) to authenticated;
