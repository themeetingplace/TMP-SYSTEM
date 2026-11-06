-- 租客簽署檔兩階段確認：LINE 回傳後先暫存，管理員確認簽名才正式掛入合約。

create table if not exists public.contract_signature_submissions (
  id uuid primary key default gen_random_uuid(),
  contract_id text not null references public.contracts(id) on delete cascade,
  tenant_id text references public.tenants(id) on delete set null,
  line_user_id text,
  storage_path text not null unique,
  final_storage_path text,
  original_file_name text,
  content_type text,
  file_size bigint,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired')),
  review_note text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);

create index if not exists idx_contract_signature_submissions_status
  on public.contract_signature_submissions(status, submitted_at desc);
create index if not exists idx_contract_signature_submissions_contract
  on public.contract_signature_submissions(contract_id, submitted_at desc);

alter table public.contract_signature_submissions enable row level security;

create or replace function public.can_review_contract_signatures()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and role in ('owner', 'admin')
  );
$$;

drop policy if exists signature_submissions_admin_select on public.contract_signature_submissions;
create policy signature_submissions_admin_select
  on public.contract_signature_submissions for select to authenticated
  using (public.can_review_contract_signatures());

drop policy if exists signature_submissions_admin_update on public.contract_signature_submissions;
create policy signature_submissions_admin_update
  on public.contract_signature_submissions for update to authenticated
  using (public.can_review_contract_signatures()) with check (public.can_review_contract_signatures());

comment on table public.contract_signature_submissions is
  'LINE 回傳的待確認簽署檔；管理員確認後才更新 contracts.signed_file_url/status。';

create or replace function public.approve_contract_signature_submission(
  p_submission_id uuid,
  p_final_storage_path text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submission public.contract_signature_submissions%rowtype;
begin
  if not public.can_review_contract_signatures() then
    raise exception 'admin access required';
  end if;

  select * into v_submission
  from public.contract_signature_submissions
  where id = p_submission_id
  for update;

  if not found then raise exception 'signature submission not found'; end if;
  if v_submission.status <> 'pending' then raise exception 'signature submission already reviewed'; end if;

  update public.contracts
  set signed_file_url = p_final_storage_path,
      status = '已簽署',
      updated_at = now()
  where id = v_submission.contract_id;

  if not found then raise exception 'contract not found'; end if;

  update public.contract_signature_submissions
  set status = 'approved',
      final_storage_path = p_final_storage_path,
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where id = p_submission_id;

  insert into public.line_messages (
    tenant_id, line_user_id, direction, message_type, content, raw
  ) values (
    v_submission.tenant_id,
    v_submission.line_user_id,
    'in',
    'file_signed',
    'signed:' || p_final_storage_path,
    jsonb_build_object(
      'key', p_final_storage_path,
      'contractId', v_submission.contract_id,
      'submissionId', p_submission_id,
      'approvedBy', auth.uid()
    )
  );
end;
$$;

create or replace function public.reject_contract_signature_submission(
  p_submission_id uuid,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_review_contract_signatures() then
    raise exception 'admin access required';
  end if;

  update public.contract_signature_submissions
  set status = 'rejected',
      review_note = nullif(trim(coalesce(p_note, '')), ''),
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where id = p_submission_id and status = 'pending';

  if not found then raise exception 'signature submission not found or already reviewed'; end if;
end;
$$;

grant execute on function public.approve_contract_signature_submission(uuid, text) to authenticated;
grant execute on function public.reject_contract_signature_submission(uuid, text) to authenticated;
grant execute on function public.can_review_contract_signatures() to authenticated;
grant select, update on public.contract_signature_submissions to authenticated;
