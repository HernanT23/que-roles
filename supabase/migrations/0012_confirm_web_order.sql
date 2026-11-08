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
  insert into public.customers(organization_id,name,phone,notes)
  values(o.organization_id,o.customer_name,o.customer_phone,'Cliente de pedido web')
  returning id into v_customer;
  v_description := 'Paquete de 3 roles x '||o.quantity_packages||'. Coberturas: '||o.toppings::text||
    '. Fecha solicitada: '||o.requested_for::text||'. Entrega: '||o.fulfillment||
    coalesce('. Dirección: '||o.delivery_address,'')||coalesce('. Nota: '||o.customer_note,'');
  insert into public.sales(organization_id,customer_id,status,subtotal,total,currency,notes,created_by)
  values(o.organization_id,v_customer,'confirmed',o.total,o.total,o.currency,'Pedido web: '||v_description,auth.uid())
  returning id into v_sale;
  insert into public.sale_items(organization_id,sale_id,product_id,description,quantity,unit_price,line_total)
  values(o.organization_id,v_sale,null,v_description,o.quantity_packages,o.total/o.quantity_packages,o.total);
  if o.payment_timing='advance' then
    insert into public.payments(organization_id,sale_id,amount,currency,method,reference,status,received_by)
    values(o.organization_id,v_sale,o.total,o.currency,'pago_movil',o.payment_reference,'confirmed',auth.uid());
    update public.web_orders set payment_status='verified' where id=o.id;
  end if;
  update public.web_orders set status='converted',sale_id=v_sale where id=o.id;
  return v_sale;
end;
$$;
revoke all on function public.confirm_web_order(uuid) from public, anon;
grant execute on function public.confirm_web_order(uuid) to authenticated;
