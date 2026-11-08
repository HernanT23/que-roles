-- Pedidos de la tienda web -> base de datos, sin Edge Function y sin llaves secretas.
-- La tienda llama a esta función con la llave pública; la función valida todo y guarda el pedido.
-- Es idempotente: reenviar el mismo pedido (misma idempotency_key) no lo duplica.
create or replace function public.submit_web_order(p_order jsonb, p_org_slug text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_org uuid;
  v_id uuid;
  v_key text := nullif(trim(coalesce(p_order->>'idempotency_key','')),'');
  v_name text := trim(coalesce(p_order->>'customer_name',''));
  v_phone text := trim(coalesce(p_order->>'customer_phone',''));
  v_qty int;
  v_tops jsonb := coalesce(p_order->'toppings','{}'::jsonb);
  v_fulf text := coalesce(p_order->>'fulfillment','');
  v_date date;
  v_timing text := coalesce(p_order->>'payment_timing','on_delivery');
  v_price numeric := 5.5;
  v_today date := (now() at time zone 'America/Caracas')::date;
  v_sum int := 0;
  v_k text;
  v_v jsonb;
begin
  if p_org_slug is null then
    select id into v_org from public.organizations order by created_at asc limit 1;
  else
    select id into v_org from public.organizations where slug = p_org_slug;
  end if;
  if v_org is null then raise exception 'Negocio no disponible'; end if;

  if v_key is null or length(v_key) > 80 then raise exception 'Pedido inválido'; end if;
  -- reenvío del mismo pedido: devolver el existente
  select id into v_id from public.web_orders where organization_id = v_org and idempotency_key = v_key;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'duplicate', true); end if;

  if length(v_name) < 2 or length(v_name) > 80 then raise exception 'Escribe tu nombre'; end if;
  if length(regexp_replace(v_phone,'\D','','g')) < 7 or length(v_phone) > 30 then raise exception 'Escribe un teléfono válido'; end if;

  begin v_qty := (p_order->>'quantity_packages')::int; exception when others then v_qty := null; end;
  if v_qty is null or v_qty < 1 or v_qty > 30 then raise exception 'Cantidad inválida'; end if;

  if v_fulf not in ('Retiro','Envío a domicilio') then raise exception 'Elige retiro o envío'; end if;
  if v_fulf = 'Envío a domicilio' and length(trim(coalesce(p_order->>'delivery_address',''))) < 5 then
    raise exception 'Indica la dirección de entrega';
  end if;

  begin v_date := (p_order->>'requested_for')::date; exception when others then v_date := null; end;
  if v_date is null then raise exception 'Elige la fecha de entrega'; end if;
  -- jueves a domingo, con 1 semana de antelación
  if v_date < v_today + 7 or v_date > v_today + 90 or extract(dow from v_date) not in (0,4,5,6) then
    raise exception 'La entrega es de jueves a domingo, con al menos 1 semana de antelación';
  end if;

  if v_timing not in ('advance','on_delivery') then raise exception 'Forma de pago inválida'; end if;

  -- coberturas: una por rol (3 por paquete)
  if jsonb_typeof(v_tops) <> 'object' then raise exception 'Coberturas inválidas'; end if;
  for v_k, v_v in select * from jsonb_each(v_tops) loop
    if length(v_k) > 40 or jsonb_typeof(v_v) <> 'number' or (v_v)::text !~ '^[0-9]{1,3}$' then
      raise exception 'Coberturas inválidas';
    end if;
    v_sum := v_sum + (v_v)::text::int;
  end loop;
  if v_sum <> v_qty * 3 then raise exception 'Completa las coberturas de todos los roles'; end if;

  -- freno de abuso: máximo 5 pedidos pendientes por teléfono en la última hora
  if (select count(*) from public.web_orders
       where organization_id = v_org and customer_phone = v_phone
         and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Demasiados pedidos seguidos. Escríbenos por WhatsApp';
  end if;

  insert into public.web_orders(organization_id, idempotency_key, customer_name, customer_phone,
      quantity_packages, item_count, toppings, fulfillment, delivery_address, maps_url, requested_for,
      payment_timing, payment_method, payment_reference, payment_status, total, currency, customer_note)
  values (v_org, v_key, v_name, v_phone, v_qty, v_qty * 3, v_tops, v_fulf,
      nullif(left(trim(coalesce(p_order->>'delivery_address','')),300),''),
      nullif(left(trim(coalesce(p_order->>'maps_url','')),300),''),
      v_date, v_timing, 'pago_movil',
      nullif(left(trim(coalesce(p_order->>'payment_reference','')),60),''),
      case when v_timing = 'advance' and nullif(trim(coalesce(p_order->>'payment_reference','')),'') is not null
           then 'pending_verification' else 'not_paid' end,
      round(v_qty * v_price, 2), 'USD',
      nullif(left(trim(coalesce(p_order->>'customer_note','')),300),''))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
revoke all on function public.submit_web_order(jsonb, text) from public;
grant execute on function public.submit_web_order(jsonb, text) to anon, authenticated;

-- Al confirmar un pedido web, reutilizar al cliente si ya existe (mismo teléfono).
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

  -- si el cliente ya existe (mismo teléfono), se reutiliza en vez de duplicarlo
  select id into v_customer from public.customers
   where organization_id=o.organization_id
     and regexp_replace(coalesce(phone,''),'\D','','g')=regexp_replace(coalesce(o.customer_phone,''),'\D','','g')
     and length(regexp_replace(coalesce(o.customer_phone,''),'\D','','g'))>=7
   order by created_at asc limit 1;
  if v_customer is null then
    insert into public.customers(organization_id,name,phone,notes)
    values(o.organization_id,o.customer_name,o.customer_phone,'Cliente de pedido web')
    returning id into v_customer;
  end if;

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
