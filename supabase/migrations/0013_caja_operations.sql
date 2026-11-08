-- Operación diaria estilo Caja: fecha de entrega, coberturas, cuentas de pago, tasa del día y venta multiproducto.
-- Es aditiva: no borra ni cambia datos existentes.

-- 1) Ventas: entrega y coberturas
alter table public.sales
  add column if not exists due_date date,
  add column if not exists delivered_at timestamptz,
  add column if not exists delivery_mode text not null default 'Retiro',
  add column if not exists delivery_address text,
  add column if not exists toppings jsonb not null default '{}'::jsonb;

-- 2) Pagos y gastos: cuenta, equivalente en USD y tasa usada
alter table public.payments
  add column if not exists account text check (account in ('pm','usd','bs')),
  add column if not exists amount_usd numeric(14,2),
  add column if not exists exchange_rate numeric(18,6);

alter table public.expenses
  add column if not exists account text check (account in ('pm','usd','bs')),
  add column if not exists amount_usd numeric(14,2),
  add column if not exists exchange_rate numeric(18,6);

-- Completar pagos existentes (los de dólares tienen equivalente directo)
update public.payments set
  account = coalesce(account, case when method='pago_movil' then 'pm' when currency='USD' then 'usd' else 'bs' end),
  amount_usd = coalesce(amount_usd, case when currency='USD' then amount end)
where account is null or amount_usd is null;

update public.expenses set
  account = coalesce(account, case when currency='USD' then 'usd' else 'bs' end),
  amount_usd = coalesce(amount_usd, case when currency='USD' then amount end)
where account is null or amount_usd is null;

-- 3) Ajustes del negocio: tasa del día y precio del paquete
create table if not exists public.org_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  exchange_rate numeric(18,6) not null default 0 check (exchange_rate >= 0),
  rate_date date,
  package_price numeric(14,2) not null default 5.5 check (package_price >= 0),
  updated_at timestamptz not null default now()
);
alter table public.org_settings enable row level security;
create policy org_settings_select on public.org_settings for select to authenticated
  using (private.is_org_member(organization_id));
create policy org_settings_insert on public.org_settings for insert to authenticated
  with check (private.has_org_role(organization_id, array['owner','admin','manager','cashier']::public.org_role[]));
create policy org_settings_update on public.org_settings for update to authenticated
  using (private.has_org_role(organization_id, array['owner','admin','manager','cashier']::public.org_role[]))
  with check (private.is_org_member(organization_id));
revoke all on public.org_settings from anon, public;
grant select, insert, update on public.org_settings to authenticated;
grant all on public.org_settings to service_role;

insert into public.org_settings(organization_id)
select id from public.organizations
on conflict (organization_id) do nothing;

-- 4) Venta completa en una sola operación (cliente, productos, coberturas y pago inicial)
create or replace function public.create_sale_v2(
  p_organization_id uuid,
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_items jsonb,
  p_toppings jsonb,
  p_due_date date,
  p_delivery_mode text,
  p_delivery_address text,
  p_notes text,
  p_rate numeric,
  p_pay_account text,
  p_pay_amount_usd numeric,
  p_pay_amount_native numeric,
  p_pay_reference text
) returns uuid
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  v_customer uuid := p_customer_id;
  v_sale uuid;
  v_total numeric(14,2) := 0;
  it jsonb;
  v_qty numeric; v_price numeric; v_desc text;
  v_pay_usd numeric(14,2) := round(coalesce(p_pay_amount_usd,0),2);
begin
  if auth.uid() is null or not private.is_org_member(p_organization_id) then
    raise exception 'No tienes acceso a este negocio';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agrega al menos un producto';
  end if;
  if p_delivery_mode not in ('Retiro','Domicilio') then raise exception 'Entrega inválida'; end if;
  if p_rate is null or p_rate < 0 then raise exception 'Tasa inválida'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'qty')::numeric; v_price := (it->>'price')::numeric;
    v_desc := nullif(trim(coalesce(it->>'name','')),'');
    if v_qty is null or v_qty <= 0 or v_price is null or v_price < 0 or v_desc is null then
      raise exception 'Producto inválido';
    end if;
    v_total := v_total + round(v_qty * v_price, 2);
  end loop;
  if v_total <= 0 then raise exception 'El total debe ser mayor a cero'; end if;
  if v_pay_usd < 0 or v_pay_usd > v_total then raise exception 'El pago debe estar entre cero y el total'; end if;

  if v_customer is null then
    if length(trim(coalesce(p_customer_name,''))) < 1 then raise exception 'Falta el nombre del cliente'; end if;
    insert into public.customers(organization_id, name, phone)
    values (p_organization_id, trim(p_customer_name), nullif(trim(coalesce(p_customer_phone,'')),''))
    returning id into v_customer;
  elsif not exists (select 1 from public.customers where id = v_customer and organization_id = p_organization_id) then
    raise exception 'Cliente no válido';
  end if;

  insert into public.sales(organization_id, customer_id, status, subtotal, total, currency, exchange_rate, notes,
                           created_by, due_date, delivery_mode, delivery_address, toppings)
  values (p_organization_id, v_customer, 'confirmed', v_total, v_total, 'USD', nullif(p_rate,0),
          nullif(trim(coalesce(p_notes,'')),''), auth.uid(), p_due_date, p_delivery_mode,
          nullif(trim(coalesce(p_delivery_address,'')),''), coalesce(p_toppings,'{}'::jsonb))
  returning id into v_sale;

  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'qty')::numeric; v_price := (it->>'price')::numeric;
    insert into public.sale_items(organization_id, sale_id, product_id, description, quantity, unit_price, line_total)
    values (p_organization_id, v_sale, null, trim(it->>'name'), v_qty, v_price, round(v_qty * v_price, 2));
  end loop;

  if v_pay_usd > 0 then
    perform public.add_payment(p_organization_id, v_sale, p_pay_account, v_pay_usd, p_pay_amount_native, p_pay_reference, p_rate);
  end if;
  return v_sale;
end;
$$;
revoke all on function public.create_sale_v2(uuid,uuid,text,text,jsonb,jsonb,date,text,text,text,numeric,text,numeric,numeric,text) from public, anon;
grant execute on function public.create_sale_v2(uuid,uuid,text,text,jsonb,jsonb,date,text,text,text,numeric,text,numeric,numeric,text) to authenticated;

-- 5) Registrar un pago sobre una venta (valida que no pase de lo que se debe)
create or replace function public.add_payment(
  p_organization_id uuid,
  p_sale_id uuid,
  p_account text,
  p_amount_usd numeric,
  p_amount_native numeric,
  p_reference text,
  p_rate numeric
) returns uuid
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  v_sale public.sales%rowtype;
  v_paid numeric;
  v_pay uuid;
  v_usd numeric(14,2) := round(coalesce(p_amount_usd,0),2);
  v_native numeric(14,2);
begin
  if auth.uid() is null or not private.is_org_member(p_organization_id) then
    raise exception 'No tienes acceso a este negocio';
  end if;
  if p_account not in ('pm','usd','bs') then raise exception 'Cuenta inválida'; end if;
  if v_usd <= 0 then raise exception 'Escribe el monto'; end if;
  select * into v_sale from public.sales where id = p_sale_id and organization_id = p_organization_id for update;
  if not found then raise exception 'Venta no encontrada'; end if;
  if v_sale.status <> 'confirmed' then raise exception 'La venta está anulada'; end if;
  select coalesce(sum(coalesce(amount_usd, case when currency='USD' then amount end, 0)),0) into v_paid
  from public.payments where sale_id = p_sale_id and organization_id = p_organization_id and status = 'confirmed';
  if v_paid + v_usd > v_sale.total + 0.005 then
    raise exception 'El pago supera lo que se debe (debe %)', round(v_sale.total - v_paid, 2);
  end if;
  v_native := case when p_account = 'usd' then v_usd else round(coalesce(nullif(p_amount_native,0), v_usd * coalesce(p_rate,0)),2) end;
  if v_native <= 0 then raise exception 'Falta la tasa del día para calcular los bolívares'; end if;
  insert into public.payments(organization_id, sale_id, amount, currency, method, reference, status, received_by,
                              account, amount_usd, exchange_rate)
  values (p_organization_id, p_sale_id, v_native,
          case when p_account = 'usd' then 'USD' else 'VES' end::public.money_currency,
          case when p_account = 'pm' then 'pago_movil' else 'cash' end,
          nullif(trim(coalesce(p_reference,'')),''), 'confirmed', auth.uid(),
          p_account, v_usd, nullif(p_rate,0))
  returning id into v_pay;
  return v_pay;
end;
$$;
revoke all on function public.add_payment(uuid,uuid,text,numeric,numeric,text,numeric) from public, anon;
grant execute on function public.add_payment(uuid,uuid,text,numeric,numeric,text,numeric) to authenticated;

-- 6) Registrar un gasto con su cuenta
create or replace function public.add_expense(
  p_organization_id uuid,
  p_description text,
  p_category text,
  p_account text,
  p_amount_usd numeric,
  p_amount_native numeric,
  p_rate numeric,
  p_paid_at timestamptz
) returns uuid
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare v_id uuid; v_usd numeric(14,2) := round(coalesce(p_amount_usd,0),2); v_native numeric(14,2);
begin
  if auth.uid() is null or not private.is_org_member(p_organization_id) then
    raise exception 'No tienes acceso a este negocio';
  end if;
  if p_account not in ('pm','usd','bs') then raise exception 'Cuenta inválida'; end if;
  if v_usd <= 0 then raise exception 'Escribe el monto'; end if;
  if length(trim(coalesce(p_description,''))) < 1 then raise exception 'Escribe en qué gastaste'; end if;
  v_native := case when p_account = 'usd' then v_usd else round(coalesce(nullif(p_amount_native,0), v_usd * coalesce(p_rate,0)),2) end;
  if v_native <= 0 then raise exception 'Falta la tasa del día para calcular los bolívares'; end if;
  insert into public.expenses(organization_id, description, category, amount, currency, paid_at, created_by,
                              account, amount_usd, exchange_rate)
  values (p_organization_id, trim(p_description), nullif(trim(coalesce(p_category,'')),''), v_native,
          case when p_account = 'usd' then 'USD' else 'VES' end::public.money_currency,
          coalesce(p_paid_at, now()), auth.uid(), p_account, v_usd, nullif(p_rate,0))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.add_expense(uuid,text,text,text,numeric,numeric,numeric,timestamptz) from public, anon;
grant execute on function public.add_expense(uuid,text,text,text,numeric,numeric,numeric,timestamptz) to authenticated;

-- 7) Pedidos de la web: al confirmar, conservar fecha de entrega, coberturas y pago en bolívares
create or replace function public.confirm_web_order(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  o public.web_orders%rowtype;
  v_customer uuid;
  v_sale uuid;
  v_description text;
  v_rate numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into o from public.web_orders where id=p_order_id for update;
  if not found then raise exception 'Pedido web no encontrado'; end if;
  if not private.has_org_role(o.organization_id,array['owner','admin','manager']::public.org_role[]) then
    raise exception 'No tienes permiso para confirmar este pedido';
  end if;
  if o.status='converted' and o.sale_id is not null then return o.sale_id; end if;
  if o.status<>'pending' then raise exception 'El pedido ya fue procesado'; end if;
  if o.payment_timing='advance' and nullif(trim(coalesce(o.payment_reference,'')),'') is null then
    raise exception 'Falta la referencia del Pago Móvil. Regístrala antes de confirmar el pago.';
  end if;
  select nullif(exchange_rate,0) into v_rate from public.org_settings where organization_id=o.organization_id;

  insert into public.customers(organization_id,name,phone,notes)
  values(o.organization_id,o.customer_name,o.customer_phone,'Cliente de pedido web')
  returning id into v_customer;

  v_description := 'Paquete de 3 roles';
  insert into public.sales(organization_id,customer_id,status,subtotal,total,currency,exchange_rate,notes,created_by,
                           due_date,delivery_mode,delivery_address,toppings)
  values(o.organization_id,v_customer,'confirmed',o.total,o.total,o.currency,v_rate,
         nullif(trim(coalesce(o.customer_note,'')),''),auth.uid(),
         o.requested_for,
         case when o.fulfillment='Retiro' then 'Retiro' else 'Domicilio' end,
         nullif(trim(coalesce(o.delivery_address,'')||' '||coalesce(o.maps_url,'')),''),
         coalesce(o.toppings,'{}'::jsonb))
  returning id into v_sale;
  insert into public.sale_items(organization_id,sale_id,product_id,description,quantity,unit_price,line_total)
  values(o.organization_id,v_sale,null,v_description,o.quantity_packages,o.total/o.quantity_packages,o.total);

  if o.payment_timing='advance' then
    insert into public.payments(organization_id,sale_id,amount,currency,method,reference,status,received_by,account,amount_usd,exchange_rate)
    values(o.organization_id,v_sale,
           case when v_rate is not null then round(o.total*v_rate,2) else o.total end,
           case when v_rate is not null then 'VES' else o.currency end::public.money_currency,
           'pago_movil',o.payment_reference,'confirmed',auth.uid(),'pm',o.total,v_rate);
    update public.web_orders set payment_status='verified' where id=o.id;
  end if;
  update public.web_orders set status='converted',sale_id=v_sale where id=o.id;
  return v_sale;
end;
$$;
revoke all on function public.confirm_web_order(uuid) from public, anon;
grant execute on function public.confirm_web_order(uuid) to authenticated;
