-- Inventario de ingredientes: entradas (compras), usos, mermas y ajustes en una sola operación.
-- Actualiza la existencia, el costo promedio (solo en dólares) y deja el movimiento registrado.
create or replace function public.adjust_ingredient(
  p_organization_id uuid,
  p_ingredient_id uuid,
  p_delta numeric,
  p_total_cost_usd numeric,
  p_movement_type text,
  p_note text
) returns numeric
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  v_ing public.ingredients%rowtype;
  v_new numeric(16,3);
  v_avg numeric(16,6);
  v_unit_cost numeric(16,6);
begin
  if auth.uid() is null or not private.is_org_member(p_organization_id) then
    raise exception 'No tienes acceso a este negocio';
  end if;
  if p_movement_type not in ('purchase','production_input','waste','adjustment') then
    raise exception 'Tipo de movimiento inválido';
  end if;
  if p_delta is null or p_delta = 0 then raise exception 'Escribe la cantidad'; end if;
  if p_movement_type = 'purchase' and p_delta < 0 then raise exception 'Una compra debe sumar existencia'; end if;
  if p_movement_type in ('production_input','waste') and p_delta > 0 then raise exception 'Un uso o merma debe restar existencia'; end if;

  select * into v_ing from public.ingredients
   where id = p_ingredient_id and organization_id = p_organization_id for update;
  if not found then raise exception 'Ingrediente no encontrado'; end if;

  v_new := v_ing.current_quantity + p_delta;
  if v_new < 0 then
    raise exception 'No hay suficiente existencia (hay % %)', v_ing.current_quantity, v_ing.base_unit;
  end if;

  v_avg := v_ing.average_unit_cost;
  if p_movement_type = 'purchase' and coalesce(p_total_cost_usd,0) > 0 and v_ing.currency = 'USD' then
    v_unit_cost := p_total_cost_usd / p_delta;
    v_avg := round((v_ing.current_quantity * v_ing.average_unit_cost + p_total_cost_usd) / v_new, 6);
  end if;

  update public.ingredients set current_quantity = v_new, average_unit_cost = v_avg
   where id = p_ingredient_id and organization_id = p_organization_id;

  insert into public.stock_movements(organization_id, ingredient_id, movement_type, quantity_delta, unit,
                                     unit_cost, currency, reference_type, note, created_by)
  values (p_organization_id, p_ingredient_id, p_movement_type, p_delta, v_ing.base_unit,
          coalesce(v_unit_cost, nullif(v_ing.average_unit_cost,0)), v_ing.currency, 'manual',
          nullif(trim(coalesce(p_note,'')),''), auth.uid());
  return v_new;
end;
$$;
revoke all on function public.adjust_ingredient(uuid,uuid,numeric,numeric,text,text) from public, anon;
grant execute on function public.adjust_ingredient(uuid,uuid,numeric,numeric,text,text) to authenticated;
