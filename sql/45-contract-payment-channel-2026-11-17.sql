-- 合約收費對象雲端同步
-- 修正 paymentChannel / platformName 只留在建立合約那台裝置，
-- 導致不同帳號的住房一覽「外部平台」標記不一致。

alter table public.contracts
  add column if not exists payment_channel text not null default 'self',
  add column if not exists platform_name text;

alter table public.contracts
  drop constraint if exists contracts_payment_channel_check;

alter table public.contracts
  add constraint contracts_payment_channel_check
  check (payment_channel in ('self', 'platform'));

comment on column public.contracts.payment_channel is
  '收費對象：self=聚空間自行收款，platform=外部平台代收';
comment on column public.contracts.platform_name is
  '外部平台名稱，例如 Airbnb、591；非平台代收時為 null';

-- 現有已確認資料：信義館 R1-A／明政／C521 為外部平台代收。
update public.contracts
set payment_channel = 'platform',
    platform_name = coalesce(platform_name, 'Airbnb')
where id = 'C521';

-- 住客姓名確認：T019／信義館 R3-B 的正式姓名為「蘇慶松」。
-- contracts / invoices / properties 是既有反正規化文字欄位，必須一起更新。
update public.tenants
set name = '蘇慶松'
where id = 'T019' and name = '蘇先生';

update public.contracts
set tenant = '蘇慶松'
where tenant = '蘇先生' and property_name = '聚空間 - 信義館 R3-B';

update public.invoices
set tenant = '蘇慶松'
where tenant = '蘇先生' and property_name = '聚空間 - 信義館 R3-B';

update public.properties
set tenant = '蘇慶松'
where tenant = '蘇先生' and name = '聚空間 - 信義館 R3-B';

update public.checkins
set tenant_name = '蘇慶松'
where tenant_name = '蘇先生' and property_name = '聚空間 - 信義館 R3-B';

update public.deposits
set tenant_name = '蘇慶松'
where tenant_name = '蘇先生' and property_name = '聚空間 - 信義館 R3-B';
