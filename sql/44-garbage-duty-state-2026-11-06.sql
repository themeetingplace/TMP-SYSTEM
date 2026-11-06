-- 垃圾值日表雲端資料：靜態工具使用 publishable key 存取，與 PMS 其他資料表完全隔離。

create table if not exists public.garbage_duty_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.garbage_duty_state enable row level security;

drop policy if exists garbage_public_select on public.garbage_duty_state;
create policy garbage_public_select
  on public.garbage_duty_state for select to anon, authenticated
  using (true);

drop policy if exists garbage_public_insert on public.garbage_duty_state;
create policy garbage_public_insert
  on public.garbage_duty_state for insert to anon, authenticated
  with check (id = 'main');

drop policy if exists garbage_public_update on public.garbage_duty_state;
create policy garbage_public_update
  on public.garbage_duty_state for update to anon, authenticated
  using (id = 'main') with check (id = 'main');

grant select, insert, update on public.garbage_duty_state to anon, authenticated;

insert into public.garbage_duty_state (id, data)
values ('main', '{}'::jsonb)
on conflict (id) do nothing;
