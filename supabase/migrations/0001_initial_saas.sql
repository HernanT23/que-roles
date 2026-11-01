-- Que Roles SaaS — migration 0001
-- Apply only to a dedicated Supabase project. Never point this migration at another product's database.

create extension if not exists pgcrypto;

create type public.org_role as enum ('owner','admin','manager','cashier','production');
create type public.subscription_status as enum ('trialing','active','past_due','paused','canceled','incomplete');
create type public.money_currency as enum ('USD','VES');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  country_code char(2) not null default 'VE',
  base_currency public.money_currency not null default 'USD',
  timezone text not null default 'America/Caracas',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  created_at timestamptz not null default now()
);

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.org_role not null default 'cashier',
  created_at timestamptz not null default now(),
  unique (organization_id,user_id)
);
create index memberships_user_idx on public.organization_memberships(user_id, organization_id);

create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  monthly_price_usd numeric(12,2) not null check (monthly_price_usd >= 0),
  max_members integer not null check (max_members > 0),
  max_products integer not null check (max_products > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.organization_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  plan_id uuid references public.subscription_plans(id),
  status public.subscription_status not null default 'trialing',
  provider text,
  provider_customer_id text,
  provider_subscription_id text unique,
  currency public.money_currency not null default 'USD',
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.billing_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  organization_id uuid references public.organizations(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  received_at timestamptz not null default now(),
  unique(provider,provider_event_id)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  address text,
  notes text,
  created_at timestamptz not null default now(),
  unique(organization_id,id)
);
create index customers_org_name_idx on public.customers(organization_id,name);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  sku text,
  category text,
  sale_price numeric(14,2) not null default 0 check (sale_price >= 0),
  currency public.money_currency not null default 'USD',
  track_stock boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(organization_id,id),
  unique(organization_id,sku)
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid,
  sale_number bigint generated always as identity,
  status text not null default 'confirmed' check (status in ('draft','confirmed','canceled','refunded')),
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  total numeric(14,2) not null default 0 check (total >= 0),
  currency public.money_currency not null default 'USD',
  exchange_rate numeric(18,6),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(organization_id,id),
  foreign key (organization_id,customer_id) references public.customers(organization_id,id)
);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sale_id uuid not null,
  product_id uuid,
  description text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  foreign key (organization_id,sale_id) references public.sales(organization_id,id) on delete restrict,
  foreign key (organization_id,product_id) references public.products(organization_id,id) on delete restrict
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sale_id uuid not null,
  amount numeric(14,2) not null check (amount > 0),
  currency public.money_currency not null,
  method text not null check (method in ('cash','pago_movil','transfer','card','zelle','other')),
  reference text,
  status text not null default 'confirmed' check (status in ('pending','confirmed','failed','refunded')),
  received_by uuid references auth.users(id),
  received_at timestamptz not null default now(),
  foreign key (organization_id,sale_id) references public.sales(organization_id,id) on delete restrict
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  description text not null,
  category text,
  amount numeric(14,2) not null check (amount > 0),
  currency public.money_currency not null default 'USD',
  paid_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  base_unit text not null check (base_unit in ('g','ml','unit')),
  current_quantity numeric(16,3) not null default 0 check (current_quantity >= 0),
  average_unit_cost numeric(16,6) not null default 0 check (average_unit_cost >= 0),
  currency public.money_currency not null default 'USD',
  min_quantity numeric(16,3) not null default 0 check (min_quantity >= 0),
  created_at timestamptz not null default now(),
  unique(organization_id,id)
);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  version integer not null default 1 check (version > 0),
  target_yield numeric(14,3) not null default 1 check (target_yield > 0),
  yield_unit text not null default 'unit',
  instructions text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(organization_id,id)
);

create table public.recipe_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipe_id uuid not null,
  ingredient_id uuid not null,
  quantity numeric(16,3) not null check (quantity > 0),
  unit text not null check (unit in ('g','ml','unit')),
  foreign key (organization_id,recipe_id) references public.recipes(organization_id,id) on delete cascade,
  foreign key (organization_id,ingredient_id) references public.ingredients(organization_id,id) on delete restrict
);

create table public.production_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipe_id uuid,
  recipe_version integer,
  status text not null default 'open' check (status in ('open','closed','canceled')),
  planned_yield numeric(14,3),
  actual_good_units numeric(14,3),
  waste_units numeric(14,3) not null default 0,
  dough_weight_g numeric(16,3),
  notes text,
  started_by uuid references auth.users(id),
  closed_by uuid references auth.users(id),
  started_at timestamptz not null default now(),
  closed_at timestamptz,
  foreign key (organization_id,recipe_id) references public.recipes(organization_id,id) on delete restrict
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ingredient_id uuid,
  product_id uuid,
  movement_type text not null check (movement_type in ('purchase','production_input','production_output','sale','waste','adjustment','reversal')),
  quantity_delta numeric(16,3) not null check (quantity_delta <> 0),
  unit text not null check (unit in ('g','ml','unit')),
  unit_cost numeric(16,6),
  currency public.money_currency not null default 'USD',
  reference_type text,
  reference_id uuid,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (num_nonnulls(ingredient_id, product_id) = 1),
  foreign key (organization_id,ingredient_id) references public.ingredients(organization_id,id) on delete restrict,
  foreign key (organization_id,product_id) references public.products(organization_id,id) on delete restrict
);

create table public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  opened_by uuid not null references auth.users(id),
  closed_by uuid references auth.users(id),
  opening_amount numeric(14,2) not null default 0 check (opening_amount >= 0),
  closing_amount numeric(14,2),
  currency public.money_currency not null default 'USD',
  status text not null default 'open' check (status in ('open','closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (organization_id,id)
);

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cash_session_id uuid not null,
  direction text not null check (direction in ('in','out')),
  concept text not null,
  amount numeric(14,2) not null check (amount > 0),
  currency public.money_currency not null,
  source_type text,
  source_id uuid,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (organization_id,cash_session_id) references public.cash_sessions(organization_id,id) on delete restrict
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Security-definer helpers avoid recursive RLS evaluation on membership policies.
create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.organization_id = p_org and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(p_org uuid, p_roles public.org_role[])
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.organization_id = p_org and m.user_id = auth.uid() and m.role = any(p_roles)
  );
$$;

revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.has_org_role(uuid, public.org_role[]) from public;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.org_role[]) to authenticated;

-- Enable RLS for every tenant table. Policies intentionally default to deny.
do $$
declare t text;
begin
  foreach t in array array[
    'organization_memberships','customers','products','sales','sale_items','payments',
    'expenses','ingredients','recipes','recipe_items','production_batches',
    'stock_movements','cash_sessions','cash_movements','audit_logs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy "members read own organizations" on public.organizations
for select to authenticated using (public.is_org_member(id));
alter table public.organizations enable row level security;

create policy "users read own memberships" on public.organization_memberships
for select to authenticated using (user_id = auth.uid() or public.has_org_role(organization_id, array['owner','admin']::public.org_role[]));

create policy "owners admins manage memberships" on public.organization_memberships
for all to authenticated
using (public.has_org_role(organization_id, array['owner','admin']::public.org_role[]))
with check (public.has_org_role(organization_id, array['owner','admin']::public.org_role[]));

create policy "profiles self read" on public.profiles for select to authenticated using (user_id = auth.uid());
create policy "profiles self insert" on public.profiles for insert to authenticated with check (user_id = auth.uid());
create policy "profiles self update" on public.profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
alter table public.profiles enable row level security;

-- Shared helper policy for organization-scoped operational tables.
do $$
declare t text;
begin
  foreach t in array array[
    'customers','products','sales','sale_items','payments','expenses','ingredients',
    'recipes','recipe_items','production_batches','stock_movements','cash_sessions','cash_movements','audit_logs'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_org_member(organization_id))',
      t || '_member_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.has_org_role(organization_id, array[''owner'',''admin'',''manager'',''cashier'',''production'']::public.org_role[]))',
      t || '_member_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.has_org_role(organization_id, array[''owner'',''admin'',''manager'',''cashier'',''production'']::public.org_role[])) with check (public.is_org_member(organization_id))',
      t || '_member_update', t);
  end loop;
end $$;

-- Immutable financial/stock history: no direct deletes. Use compensating records.
create policy "no direct delete sales" on public.sales for delete to authenticated using (false);
create policy "no direct delete payments" on public.payments for delete to authenticated using (false);
create policy "no direct delete stock movements" on public.stock_movements for delete to authenticated using (false);
create policy "no direct delete audit logs" on public.audit_logs for delete to authenticated using (false);

-- Subscription data is intentionally not client-writable; service backend handles verified billing events.
alter table public.subscription_plans enable row level security;
alter table public.organization_subscriptions enable row level security;
alter table public.billing_events enable row level security;
create policy "active plans visible" on public.subscription_plans for select to authenticated using (active = true);
create policy "members read subscription" on public.organization_subscriptions for select to authenticated using (public.is_org_member(organization_id));
-- No authenticated insert/update/delete policy for billing records.


-- Secure self-service tenant bootstrap. Client cannot directly insert an organization or assign itself an owner role.
create or replace function public.create_organization(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $
declare new_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if length(trim(coalesce(p_name,''))) < 2 or length(trim(p_name)) > 120 then
    raise exception 'Invalid organization name';
  end if;
  if p_slug !~ '^[a-z0-9][a-z0-9-]{1,62} pricing can be adjusted before commercial launch.
insert into public.subscription_plans(code,name,monthly_price_usd,max_members,max_products)
values ('starter','Inicial',9.00,3,200)
on conflict (code) do nothing;
 then
    raise exception 'Invalid organization slug';
  end if;
  insert into public.organizations(name,slug)
  values (trim(p_name),p_slug)
  returning id into new_org_id;
  insert into public.organization_memberships(organization_id,user_id,role)
  values (new_org_id,auth.uid(),'owner');
  insert into public.organization_subscriptions(organization_id,status,trial_ends_at)
  values (new_org_id,'trialing',now() + interval '14 days');
  return new_org_id;
end;
$;
revoke all on function public.create_organization(text,text) from public;
grant execute on function public.create_organization(text,text) to authenticated;

-- Seed a starter plan; pricing can be adjusted before commercial launch.
insert into public.subscription_plans(code,name,monthly_price_usd,max_members,max_products)
values ('starter','Inicial',9.00,3,200)
on conflict (code) do nothing;
