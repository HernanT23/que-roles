-- Avoid repeated auth context lookups and remove duplicate permissive SELECT policies.
drop policy if exists "users read own memberships" on public.organization_memberships;
create policy "users read own memberships" on public.organization_memberships
for select to authenticated
using ((select auth.uid()) = user_id or private.has_org_role(organization_id, array['owner','admin']::public.org_role[]));

drop policy if exists "owners admins manage memberships" on public.organization_memberships;
create policy "owners admins insert memberships" on public.organization_memberships
for insert to authenticated
with check (private.has_org_role(organization_id, array['owner','admin']::public.org_role[]));
create policy "owners admins update memberships" on public.organization_memberships
for update to authenticated
using (private.has_org_role(organization_id, array['owner','admin']::public.org_role[]))
with check (private.has_org_role(organization_id, array['owner','admin']::public.org_role[]));
create policy "owners admins delete memberships" on public.organization_memberships
for delete to authenticated
using (private.has_org_role(organization_id, array['owner','admin']::public.org_role[]));

drop policy if exists "profiles self read" on public.profiles;
drop policy if exists "profiles self insert" on public.profiles;
drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self read" on public.profiles
for select to authenticated using (user_id = (select auth.uid()));
create policy "profiles self insert" on public.profiles
for insert to authenticated with check (user_id = (select auth.uid()));
create policy "profiles self update" on public.profiles
for update to authenticated using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- Add a covering index for each foreign key only when no existing index already covers its leading columns.
do $$
declare fk record; index_columns text; index_name text; has_covering_index boolean;
begin
  for fk in
    select con.oid, con.conname, con.conrelid, con.conkey, rel.relname as table_name, ns.nspname as schema_name
    from pg_constraint con join pg_class rel on rel.oid=con.conrelid
    join pg_namespace ns on ns.oid=rel.relnamespace
    where con.contype='f' and ns.nspname='public'
  loop
    select string_agg(format('%I',a.attname),', ' order by k.ord) into index_columns
    from unnest(fk.conkey) with ordinality as k(attnum,ord)
    join pg_attribute a on a.attrelid=fk.conrelid and a.attnum=k.attnum;
    select exists(
      select 1 from pg_index i where i.indrelid=fk.conrelid and i.indisvalid and i.indisready
      and (select array_agg(k.attnum::smallint order by k.ord)
           from unnest(i.indkey::smallint[]) with ordinality as k(attnum,ord)
           where k.ord<=cardinality(fk.conkey))=fk.conkey
    ) into has_covering_index;
    if not has_covering_index then
      index_name:=left('idx_'||fk.table_name||'_'||substr(md5(fk.conname),1,8),63);
      execute format('create index if not exists %I on %I.%I (%s)',index_name,fk.schema_name,fk.table_name,index_columns);
    end if;
  end loop;
end $$;

-- High-frequency list and stock lookup paths.
create index if not exists sales_org_created_idx on public.sales (organization_id,created_at desc);
create index if not exists expenses_org_paid_idx on public.expenses (organization_id,paid_at desc);
create index if not exists production_batches_org_started_idx on public.production_batches (organization_id,started_at desc);
create index if not exists products_org_name_idx on public.products (organization_id,name);
create index if not exists ingredients_org_name_idx on public.ingredients (organization_id,name);
create index if not exists recipes_org_name_idx on public.recipes (organization_id,name);
create index if not exists stock_movements_org_product_idx on public.stock_movements (organization_id,product_id);
create index if not exists cash_sessions_org_status_opened_idx on public.cash_sessions (organization_id,status,opened_at desc);
create index if not exists cash_movements_session_created_idx on public.cash_movements (cash_session_id,created_at desc);