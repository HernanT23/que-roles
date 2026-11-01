-- Serialize stock checks per product to prevent concurrent sales from overselling.
create or replace function public.create_sale(
  p_organization_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_unit_price numeric,
  p_customer_id uuid default null,
  p_payment_amount numeric default 0,
  p_payment_method text default 'cash',
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare v_product public.products%rowtype; v_sale_id uuid; v_total numeric(14,2); v_available numeric(16,3);
begin
  if auth.uid() is null or not private.is_org_member(p_organization_id) then raise exception 'No tienes acceso a este negocio'; end if;
  if p_quantity is null or p_quantity <= 0 or p_unit_price is null or p_unit_price < 0 then raise exception 'Cantidad o precio inválido'; end if;
  select * into v_product from public.products where id=p_product_id and organization_id=p_organization_id and active=true for update;
  if not found then raise exception 'Producto no disponible'; end if;
  if p_customer_id is not null and not exists(select 1 from public.customers where id=p_customer_id and organization_id=p_organization_id) then raise exception 'Cliente no válido'; end if;
  v_total:=round(p_quantity*p_unit_price,2);
  if coalesce(p_payment_amount,0)<0 or coalesce(p_payment_amount,0)>v_total then raise exception 'El abono debe estar entre cero y el total'; end if;
  if coalesce(p_payment_amount,0)>0 and p_payment_method not in ('cash','pago_movil','transfer','card','zelle','other') then raise exception 'Método de pago inválido'; end if;
  if v_product.track_stock then
    select coalesce(sum(quantity_delta),0) into v_available from public.stock_movements where organization_id=p_organization_id and product_id=p_product_id;
    if v_available<p_quantity then raise exception 'Existencia insuficiente. Disponible: %',v_available; end if;
  end if;
  insert into public.sales(organization_id,customer_id,status,subtotal,total,currency,notes,created_by)
  values(p_organization_id,p_customer_id,'confirmed',v_total,v_total,v_product.currency,nullif(trim(coalesce(p_notes,'')),''),auth.uid()) returning id into v_sale_id;
  insert into public.sale_items(organization_id,sale_id,product_id,description,quantity,unit_price,line_total)
  values(p_organization_id,v_sale_id,p_product_id,v_product.name,p_quantity,p_unit_price,v_total);
  if coalesce(p_payment_amount,0)>0 then
    insert into public.payments(organization_id,sale_id,amount,currency,method,status,received_by)
    values(p_organization_id,v_sale_id,p_payment_amount,v_product.currency,p_payment_method,'confirmed',auth.uid());
  end if;
  if v_product.track_stock then
    insert into public.stock_movements(organization_id,product_id,movement_type,quantity_delta,unit,currency,reference_type,reference_id,note,created_by)
    values(p_organization_id,p_product_id,'sale',-p_quantity,'unit',v_product.currency,'sale',v_sale_id,'Salida por venta',auth.uid());
  end if;
  return v_sale_id;
end;
$$;
revoke all on function public.create_sale(uuid,uuid,numeric,numeric,uuid,numeric,text,text) from public,anon;
grant execute on function public.create_sale(uuid,uuid,numeric,numeric,uuid,numeric,text,text) to authenticated;