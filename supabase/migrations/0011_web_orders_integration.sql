create table if not exists public.web_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  idempotency_key text not null,
  customer_name text not null,
  customer_phone text,
  quantity_packages integer not null check (quantity_packages between 1 and 30),
  item_count integer not null check (item_count = quantity_packages * 3),
  toppings jsonb not null default '{}'::jsonb,
  fulfillment text not null check (fulfillment in ('Retiro','Envío a domicilio')),
  delivery_address text,
  maps_url text,
  requested_for date not null,
  payment_timing text not null check (payment_timing in ('advance','on_delivery')),
  payment_method text not null default 'pago_movil',
  payment_reference text,
  payment_status text not null default 'not_paid' check (payment_status in ('not_paid','pending_verification','verified','rejected')),
  total numeric(14,2) not null check (total > 0),
  currency public.money_currency not null default 'USD',
  customer_note text,
  status text not null default 'pending' check (status in ('pending','accepted','rejected','converted')),
  sale_id uuid,
  created_at timestamptz not null default now(),
  unique (organization_id,idempotency_key),
  foreign key (organization_id,sale_id) references public.sales(organization_id,id) on delete set null
);
create index if not exists web_orders_org_created_idx on public.web_orders(organization_id,created_at desc);
create index if not exists web_orders_org_status_date_idx on public.web_orders(organization_id,status,requested_for);
alter table public.web_orders enable row level security;
create policy web_orders_member_select on public.web_orders for select to authenticated using (private.is_org_member(organization_id));
create policy web_orders_member_update on public.web_orders for update to authenticated using (private.has_org_role(organization_id,array['owner','admin','manager']::public.org_role[])) with check (private.is_org_member(organization_id));
revoke all on public.web_orders from anon, public;
grant select, update on public.web_orders to authenticated;
grant all on public.web_orders to service_role;
