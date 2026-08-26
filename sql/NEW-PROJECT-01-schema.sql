-- ============================================================================
-- 聚空間 PMS — 新專案建置 SQL (schema only, 不含資料)
-- 來源: 舊專案 zkwkycpfcyecebstmotc 的實際結構 (2026-08-22 用 MCP 產出)
-- 用法: 到新專案 Supabase Dashboard → SQL Editor → 全選貼上 → Run
--       跑完再跑第二份 NEW-PROJECT-02-data.sql (資料匯入)
-- ============================================================================

-- ===== 1. sequences (audit_log / line_messages 的 bigint id) =====
create sequence if not exists public.audit_log_id_seq;
create sequence if not exists public.line_messages_id_seq;

-- ===== 2. tables =====
create table if not exists public.admins (
  email text not null,
  display_name text,
  role text not null default 'admin'::text,
  created_at timestamp with time zone default now(),
  allowed_buildings jsonb not null default '[]'::jsonb,
  allowed_views jsonb not null default '[]'::jsonb
);

create table if not exists public.audit_log (
  id bigint not null default nextval('audit_log_id_seq'::regclass),
  table_name text not null,
  row_id text not null,
  action text not null,
  actor_email text,
  actor_role text,
  before_data jsonb,
  after_data jsonb,
  changed_at timestamp with time zone default now()
);

create table if not exists public.buildings (
  id text not null,
  name text not null,
  base_address text,
  "group" text,
  status text default 'active'::text,
  note text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  mode text default 'cohousing'::text,
  owner_id text,
  layout text,
  area_size numeric,
  monthly_rent numeric,
  rent_includes_tax boolean default false,
  rent_term text,
  tax_reported boolean default false,
  developer text,
  manager text,
  managed_start_date date,
  managed_end_date date,
  fee_type text default 'fixed'::text,
  fee_config jsonb default '{}'::jsonb,
  energy_mode text,
  owner_name text default ''::text,
  owner_gender text default ''::text,
  owner_phone text default ''::text,
  owner_email text default ''::text,
  owner_line_id text default ''::text
);

create table if not exists public.checkins (
  id text not null,
  tenant_name text,
  property_name text,
  scheduled_date date,
  status text,
  tasks jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.contract_templates (
  building_id text not null,
  file_name text,
  pdf_base64 text,
  uploaded_at timestamp with time zone default now(),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.contracts (
  id text not null,
  property_id text,
  property_name text,
  tenant text,
  sign_date date,
  start_date date,
  end_date date,
  term_months integer,
  status text,
  amount integer,
  deposit_amount integer default 0,
  parent_contract_id text,
  renewal_state text default 'active'::text,
  snooze_until date,
  signed_file_url text,
  terminated_date date,
  decision_taken_at timestamp with time zone,
  decision_note text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  renew_intent text,
  renew_asked_at timestamp with time zone,
  renew_response_at timestamp with time zone,
  renew_note text,
  contract_type text not null default 'cohousing'::text,
  owner_id text,
  lessor_name text,
  building_id text,
  contract_sent_at timestamp with time zone,
  pending_termination_date date,
  bundle_parent_contract_id text,
  bundle_original_amount numeric
);

create table if not exists public.deposits (
  id text not null,
  contract_id text,
  tenant_name text default ''::text,
  property_name text default ''::text,
  building_id text,
  amount numeric default 0,
  holder text default 'pms'::text,
  collected_date date,
  transferred_date date,
  note text default ''::text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.invoice_types (
  id text not null,
  name text not null,
  direction text not null,
  is_recurring boolean default false,
  note text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.invoices (
  id text not null,
  contract_id text,
  direction text not null,
  building_id text,
  property_name text,
  tenant text,
  type text not null,
  amount integer not null,
  due_date date,
  status text,
  paid_date date,
  period_start date,
  period_end date,
  note text,
  bank_last5 text,
  bank_verified boolean default false,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  discount numeric default 0,
  discount_reason text,
  paid_amount numeric default 0,
  payment_method text,
  last_reminder_at timestamp with time zone,
  period_tag text
);

create table if not exists public.line_messages (
  id bigint not null default nextval('line_messages_id_seq'::regclass),
  tenant_id text,
  line_user_id text,
  direction text not null,
  message_type text,
  content text,
  raw jsonb,
  created_at timestamp with time zone default now(),
  webhook_event_id text
);

create table if not exists public.maintenances (
  id text not null,
  property_name text,
  issue text,
  reporter text,
  report_date date,
  status text,
  cost integer,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  building_id text
);

create table if not exists public.management_leads (
  id uuid not null default gen_random_uuid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  name text not null,
  phone text,
  line_id text,
  email text,
  area text,
  property_type text,
  acreage numeric,
  room_count integer,
  timing text,
  property_status jsonb not null default '[]'::jsonb,
  services jsonb not null default '[]'::jsonb,
  main_problem text,
  message text,
  status text not null default 'new'::text,
  handled_by text,
  note text,
  source text not null default 'website'::text
);

create table if not exists public.owners (
  id text not null,
  name text not null,
  gender text default ''::text,
  phone text default ''::text,
  email text default ''::text,
  line_id text default ''::text,
  source text default '員工面談'::text,
  how_known text default ''::text,
  how_known_other text default ''::text,
  note text default ''::text,
  status text default 'active'::text,
  submitted_at timestamp with time zone default now(),
  reviewed_by text,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.payment_methods (
  id text not null,
  name text not null,
  note text,
  updated_at timestamp with time zone default now()
);

create table if not exists public.profiles (
  id uuid not null,
  email text not null,
  full_name text not null,
  role text default 'user'::text,
  company_name text,
  phone text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.properties (
  id text not null,
  building_id text,
  name text not null,
  address text,
  status text,
  rent integer,
  tenant text,
  contract_id text,
  contract_end date,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  room_number integer,
  bed_letter text,
  gender text,
  capacity integer
);

create table if not exists public.rent_rules (
  id text not null,
  name text not null,
  amount numeric not null default 0,
  months integer[] not null default '{}'::integer[],
  building_ids text[] not null default '{}'::text[],
  enabled boolean default true,
  note text default ''::text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.settlements (
  id text not null,
  owner_id text,
  building_id text,
  month text not null,
  items jsonb default '[]'::jsonb,
  owner_receivable numeric default 0,
  deposit_collected_this_month numeric default 0,
  deposit_transferred_this_month numeric default 0,
  owner_holding_deposit_total numeric default 0,
  status text default 'draft'::text,
  sent_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.tenant_sources (
  id text not null,
  name text not null,
  note text,
  updated_at timestamp with time zone default now()
);

create table if not exists public.tenants (
  id text not null,
  name text not null,
  phone text,
  email text,
  current_property text,
  status text,
  emergency_contact text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  line_user_id text,
  line_display_name text,
  line_picture_url text,
  line_bound_at timestamp with time zone,
  source text,
  note text,
  id_card_front_path text,
  id_card_back_path text,
  id_card_uploaded_at timestamp with time zone
);

-- ===== 3. primary key / unique / check =====
alter table public.admins add constraint admins_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'viewer'::text, 'helper'::text])));
alter table public.admins add constraint admins_pkey PRIMARY KEY (email);
alter table public.audit_log add constraint audit_log_action_check CHECK ((action = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text])));
alter table public.audit_log add constraint audit_log_pkey PRIMARY KEY (id);
alter table public.buildings add constraint buildings_pkey PRIMARY KEY (id);
alter table public.checkins add constraint checkins_pkey PRIMARY KEY (id);
alter table public.contract_templates add constraint contract_templates_pkey PRIMARY KEY (building_id);
alter table public.contracts add constraint contracts_contract_type_check CHECK ((contract_type = ANY (ARRAY['cohousing'::text, 'managed-owner'::text, 'managed-tenant'::text])));
alter table public.contracts add constraint contracts_pkey PRIMARY KEY (id);
alter table public.deposits add constraint deposits_pkey PRIMARY KEY (id);
alter table public.invoice_types add constraint invoice_types_pkey PRIMARY KEY (id);
alter table public.invoices add constraint invoices_pkey PRIMARY KEY (id);
alter table public.line_messages add constraint line_messages_pkey PRIMARY KEY (id);
alter table public.maintenances add constraint maintenances_pkey PRIMARY KEY (id);
alter table public.management_leads add constraint management_leads_pkey PRIMARY KEY (id);
alter table public.owners add constraint owners_pkey PRIMARY KEY (id);
alter table public.payment_methods add constraint payment_methods_pkey PRIMARY KEY (id);
alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id);
alter table public.properties add constraint properties_pkey PRIMARY KEY (id);
alter table public.rent_rules add constraint rent_rules_pkey PRIMARY KEY (id);
alter table public.settlements add constraint settlements_pkey PRIMARY KEY (id);
alter table public.tenant_sources add constraint tenant_sources_pkey PRIMARY KEY (id);
alter table public.tenants add constraint tenants_pkey PRIMARY KEY (id);

-- ===== 4. foreign keys =====
alter table public.buildings add constraint buildings_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE SET NULL;
alter table public.contract_templates add constraint contract_templates_building_id_fkey FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE CASCADE;
alter table public.contracts add constraint contracts_building_id_fkey FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE SET NULL;
alter table public.contracts add constraint contracts_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE SET NULL;
alter table public.contracts add constraint contracts_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;
alter table public.deposits add constraint deposits_building_id_fkey FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE SET NULL;
alter table public.deposits add constraint deposits_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE SET NULL;
alter table public.invoices add constraint invoices_building_id_fkey FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE SET NULL;
alter table public.invoices add constraint invoices_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE SET NULL;
alter table public.line_messages add constraint line_messages_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;
alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id);
alter table public.properties add constraint properties_building_id_fkey FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE SET NULL;
alter table public.settlements add constraint settlements_building_id_fkey FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE SET NULL;
alter table public.settlements add constraint settlements_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE SET NULL;

-- ===== 5. indexes =====
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON public.audit_log USING btree (actor_email);
CREATE INDEX IF NOT EXISTS audit_log_changed_at_idx ON public.audit_log USING btree (changed_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_table_row_idx ON public.audit_log USING btree (table_name, row_id);
CREATE INDEX IF NOT EXISTS buildings_mode_idx ON public.buildings USING btree (mode);
CREATE INDEX IF NOT EXISTS buildings_owner_idx ON public.buildings USING btree (owner_id);
CREATE INDEX IF NOT EXISTS contracts_building_id_idx ON public.contracts USING btree (building_id) WHERE (building_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS contracts_contract_type_idx ON public.contracts USING btree (contract_type);
CREATE INDEX IF NOT EXISTS contracts_owner_id_idx ON public.contracts USING btree (owner_id) WHERE (owner_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS deposits_building_idx ON public.deposits USING btree (building_id);
CREATE INDEX IF NOT EXISTS deposits_holder_idx ON public.deposits USING btree (holder);
CREATE INDEX IF NOT EXISTS idx_contracts_contract_sent_at ON public.contracts USING btree (contract_sent_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_contracts_end_date ON public.contracts USING btree (end_date);
CREATE INDEX IF NOT EXISTS idx_contracts_property_id ON public.contracts USING btree (property_id);
CREATE INDEX IF NOT EXISTS idx_contracts_renewal_scan ON public.contracts USING btree (renewal_state, end_date, renew_intent) WHERE (renewal_state = 'active'::text);
CREATE INDEX IF NOT EXISTS idx_contracts_state ON public.contracts USING btree (renewal_state);
CREATE INDEX IF NOT EXISTS idx_invoices_building_id ON public.invoices USING btree (building_id);
CREATE INDEX IF NOT EXISTS idx_invoices_contract_id ON public.invoices USING btree (contract_id);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON public.invoices USING btree (due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_period_tag ON public.invoices USING btree (period_tag) WHERE (period_tag IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.invoices USING btree (status);
CREATE INDEX IF NOT EXISTS idx_line_messages_created ON public.line_messages USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_line_messages_tenant ON public.line_messages USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_management_leads_status_created ON public.management_leads USING btree (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_properties_building_id ON public.properties USING btree (building_id);
CREATE INDEX IF NOT EXISTS idx_properties_building_room ON public.properties USING btree (building_id, room_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_line_user_id ON public.tenants USING btree (line_user_id) WHERE (line_user_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_tenants_source ON public.tenants USING btree (source);
CREATE UNIQUE INDEX IF NOT EXISTS line_messages_webhook_event_id_uniq ON public.line_messages USING btree (webhook_event_id) WHERE (webhook_event_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS owners_status_idx ON public.owners USING btree (status);
CREATE INDEX IF NOT EXISTS settlements_month_idx ON public.settlements USING btree (month);
CREATE INDEX IF NOT EXISTS settlements_owner_idx ON public.settlements USING btree (owner_id);

-- ===== 6. functions =====
CREATE OR REPLACE FUNCTION public.audit_log_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_email text;
  v_role  text;
  v_id    text;
BEGIN
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  IF v_email = '' THEN v_email := NULL; END IF;
  IF v_email IS NOT NULL THEN
    SELECT role INTO v_role FROM admins WHERE lower(email) = v_email LIMIT 1;
  END IF;
  IF (TG_OP = 'DELETE') THEN
    v_id := COALESCE(OLD.id::text, '');
    INSERT INTO audit_log (table_name, row_id, action, actor_email, actor_role, before_data)
    VALUES (TG_TABLE_NAME, v_id, 'DELETE', v_email, v_role, to_jsonb(OLD));
    RETURN OLD;
  ELSIF (TG_OP = 'UPDATE') THEN
    v_id := COALESCE(NEW.id::text, '');
    INSERT INTO audit_log (table_name, row_id, action, actor_email, actor_role, before_data, after_data)
    VALUES (TG_TABLE_NAME, v_id, 'UPDATE', v_email, v_role, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSE
    v_id := COALESCE(NEW.id::text, '');
    INSERT INTO audit_log (table_name, row_id, action, actor_email, actor_role, after_data)
    VALUES (TG_TABLE_NAME, v_id, 'INSERT', v_email, v_role, to_jsonb(NEW));
    RETURN NEW;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_allowed_buildings()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(allowed_buildings, '[]'::jsonb)
  from admins
  where email = (auth.jwt() ->> 'email')
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_allowed_views()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(allowed_views, '[]'::jsonb)
  from admins
  where email = (auth.jwt() ->> 'email')
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_role()
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT role
    FROM admins
    WHERE email = (auth.jwt() ->> 'email')
    LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM admins
    WHERE lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM admins
    WHERE email = lower(auth.jwt() ->> 'email')
      AND role = 'owner'
  );
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.touch_management_leads_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_rent_rules_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$;

grant execute on function public.get_my_allowed_buildings() to authenticated, anon;
grant execute on function public.get_my_allowed_views() to authenticated, anon;
grant execute on function public.get_my_role() to authenticated, anon;
grant execute on function public.is_admin() to authenticated, anon;
grant execute on function public.is_owner() to authenticated, anon;

-- ===== 7. triggers =====
CREATE TRIGGER audit_log_buildings AFTER INSERT OR DELETE OR UPDATE ON public.buildings FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();
CREATE TRIGGER trg_buildings_updated_at BEFORE UPDATE ON public.buildings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_checkins_updated_at BEFORE UPDATE ON public.checkins FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_contract_templates_updated_at BEFORE UPDATE ON public.contract_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER audit_log_contracts AFTER INSERT OR DELETE OR UPDATE ON public.contracts FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();
CREATE TRIGGER trg_contracts_updated_at BEFORE UPDATE ON public.contracts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER deposits_set_updated_at BEFORE UPDATE ON public.deposits FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_invoice_types_updated_at BEFORE UPDATE ON public.invoice_types FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER audit_log_invoices AFTER INSERT OR DELETE OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();
CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_maintenances_updated_at BEFORE UPDATE ON public.maintenances FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_management_leads_updated_at BEFORE UPDATE ON public.management_leads FOR EACH ROW EXECUTE FUNCTION touch_management_leads_updated_at();
CREATE TRIGGER audit_log_owners AFTER INSERT OR DELETE OR UPDATE ON public.owners FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();
CREATE TRIGGER owners_set_updated_at BEFORE UPDATE ON public.owners FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER audit_log_properties AFTER INSERT OR DELETE OR UPDATE ON public.properties FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();
CREATE TRIGGER trg_properties_updated_at BEFORE UPDATE ON public.properties FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_rent_rules_updated_at BEFORE UPDATE ON public.rent_rules FOR EACH ROW EXECUTE FUNCTION update_rent_rules_updated_at();
CREATE TRIGGER settlements_set_updated_at BEFORE UPDATE ON public.settlements FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER audit_log_tenants AFTER INSERT OR DELETE OR UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();
CREATE TRIGGER trg_tenants_updated_at BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ===== 8. RLS enable =====
alter table public.admins enable row level security;
alter table public.audit_log enable row level security;
alter table public.buildings enable row level security;
alter table public.checkins enable row level security;
alter table public.contract_templates enable row level security;
alter table public.contracts enable row level security;
alter table public.deposits enable row level security;
alter table public.invoice_types enable row level security;
alter table public.invoices enable row level security;
alter table public.line_messages enable row level security;
alter table public.maintenances enable row level security;
alter table public.management_leads enable row level security;
alter table public.owners enable row level security;
alter table public.payment_methods enable row level security;
alter table public.profiles enable row level security;
alter table public.properties enable row level security;
alter table public.rent_rules enable row level security;
alter table public.settlements enable row level security;
alter table public.tenant_sources enable row level security;
alter table public.tenants enable row level security;

-- ===== 9. policies (public tables) =====
create policy admins_delete on public.admins as permissive for delete to authenticated using (is_owner());
create policy admins_insert on public.admins as permissive for insert to authenticated with check (is_owner());
create policy admins_read on public.admins as permissive for select to authenticated using (is_admin());
create policy admins_update on public.admins as permissive for update to authenticated using (is_owner()) with check (is_owner());
create policy audit_log_no_delete on public.audit_log as permissive for delete to authenticated using (false);
create policy audit_log_no_update on public.audit_log as permissive for update to authenticated using (false);
create policy audit_log_no_write on public.audit_log as permissive for insert to authenticated with check (false);
create policy audit_log_select_admins on public.audit_log as permissive for select to authenticated using (is_admin());
create policy admin_all on public.buildings as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all_buildings on public.buildings as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all on public.checkins as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all_checkins on public.checkins as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all on public.contract_templates as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all_contract_templates on public.contract_templates as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all on public.contracts as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all_contracts on public.contracts as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all_deposits on public.deposits as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all on public.invoice_types as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all_invoice_types on public.invoice_types as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all on public.invoices as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all_invoices on public.invoices as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all_line_messages on public.line_messages as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all on public.maintenances as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all_maintenances on public.maintenances as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_delete_management_leads on public.management_leads as permissive for delete to authenticated using (is_admin());
create policy admin_insert_management_leads on public.management_leads as permissive for insert to authenticated with check (is_admin());
create policy admin_select_management_leads on public.management_leads as permissive for select to authenticated using (is_admin());
create policy admin_update_management_leads on public.management_leads as permissive for update to authenticated using (is_admin()) with check (is_admin());
create policy anon_insert_management_leads on public.management_leads as permissive for insert to anon with check (((status = 'new'::text) AND (handled_by IS NULL) AND (note IS NULL) AND (source = 'website'::text) AND ((length(COALESCE(name, ''::text)) >= 1) AND (length(COALESCE(name, ''::text)) <= 100)) AND (length(COALESCE(message, ''::text)) <= 2000)));
create policy admin_all_owners on public.owners as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all on public.payment_methods as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all_payment_methods on public.payment_methods as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all on public.properties as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all_properties on public.properties as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all on public.rent_rules as permissive for all to public using (is_admin());
create policy admin_all_settlements on public.settlements as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all on public.tenant_sources as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all_tenant_sources on public.tenant_sources as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all on public.tenants as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all_tenants on public.tenants as permissive for all to authenticated using (is_admin()) with check (is_admin());

-- ===== 10. storage buckets =====
insert into storage.buckets (id, name, public) values ('contract-pdfs', 'contract-pdfs', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('id-cards', 'id-cards', false) on conflict (id) do nothing;

-- ===== 11. storage policies (on storage.objects) =====
create policy auth_all_contract_pdfs on storage.objects as permissive for all to authenticated using ((bucket_id = 'contract-pdfs'::text)) with check ((bucket_id = 'contract-pdfs'::text));
create policy authenticated_delete_contract_pdfs on storage.objects as permissive for delete to authenticated using ((bucket_id = 'contract-pdfs'::text));
create policy authenticated_update_contract_pdfs on storage.objects as permissive for update to authenticated using ((bucket_id = 'contract-pdfs'::text));
create policy authenticated_upload_contract_pdfs on storage.objects as permissive for insert to authenticated with check ((bucket_id = 'contract-pdfs'::text));
create policy id_cards_admin_delete on storage.objects as permissive for delete to authenticated using (((bucket_id = 'id-cards'::text) AND is_admin()));
create policy id_cards_admin_read on storage.objects as permissive for select to authenticated using (((bucket_id = 'id-cards'::text) AND is_admin()));
create policy id_cards_admin_update on storage.objects as permissive for update to authenticated using (((bucket_id = 'id-cards'::text) AND is_admin()));
create policy id_cards_admin_write on storage.objects as permissive for insert to authenticated with check (((bucket_id = 'id-cards'::text) AND is_admin()));
create policy public_read_contract_pdfs on storage.objects as permissive for select to public using ((bucket_id = 'contract-pdfs'::text));

-- ===== 12. realtime publication =====
alter publication supabase_realtime add table public.buildings;
alter publication supabase_realtime add table public.checkins;
alter publication supabase_realtime add table public.contract_templates;
alter publication supabase_realtime add table public.contracts;
alter publication supabase_realtime add table public.deposits;
alter publication supabase_realtime add table public.invoice_types;
alter publication supabase_realtime add table public.invoices;
alter publication supabase_realtime add table public.line_messages;
alter publication supabase_realtime add table public.maintenances;
alter publication supabase_realtime add table public.owners;
alter publication supabase_realtime add table public.payment_methods;
alter publication supabase_realtime add table public.properties;
alter publication supabase_realtime add table public.settlements;
alter publication supabase_realtime add table public.tenant_sources;
alter publication supabase_realtime add table public.tenants;

-- ============================================================================
-- 完成。跑完到 Table Editor 應看到 20 張表。接著跑 NEW-PROJECT-02-data.sql。
-- ============================================================================
