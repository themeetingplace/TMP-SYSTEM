-- 系統通知共用已讀紀錄：由登入帳號寫入，所有工作帳號與裝置共用同一狀態。

create table if not exists public.system_notification_reads (
  notification_id text primary key,
  read_at timestamptz not null default now(),
  read_by uuid references auth.users(id) on delete set null,
  read_by_email text
);

create index if not exists idx_system_notification_reads_read_at
  on public.system_notification_reads(read_at desc);

alter table public.system_notification_reads enable row level security;

create or replace function public.can_access_system_notifications()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.prepare_system_notification_read()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.can_access_system_notifications() then
    raise exception 'staff access required';
  end if;
  new.read_at := now();
  new.read_by := auth.uid();
  new.read_by_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  return new;
end;
$$;

drop trigger if exists system_notification_reads_prepare on public.system_notification_reads;
create trigger system_notification_reads_prepare
before insert on public.system_notification_reads
for each row execute function public.prepare_system_notification_read();

drop policy if exists system_notification_reads_select on public.system_notification_reads;
create policy system_notification_reads_select
  on public.system_notification_reads for select to authenticated
  using (public.can_access_system_notifications());

drop policy if exists system_notification_reads_insert on public.system_notification_reads;
create policy system_notification_reads_insert
  on public.system_notification_reads for insert to authenticated
  with check (public.can_access_system_notifications());

grant execute on function public.can_access_system_notifications() to authenticated;
grant select, insert on public.system_notification_reads to authenticated;

-- Realtime 用於讓已開啟的手機／電腦立即移除其他帳號剛處理的通知。
do $$
begin
  alter publication supabase_realtime add table public.system_notification_reads;
exception
  when duplicate_object then null;
end $$;
