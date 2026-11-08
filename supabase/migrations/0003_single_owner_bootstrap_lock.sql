-- Lock first-run organization provisioning to the initial anonymous instance.
-- This private app must have exactly one workspace.
create or replace function public.create_organization(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare new_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is not true then
    raise exception 'Anonymous owner session required';
  end if;
  if exists (select 1 from public.organizations) then
    raise exception 'Workspace already provisioned';
  end if;
  if length(trim(coalesce(p_name,''))) < 2 or length(trim(p_name)) > 120 then
    raise exception 'Invalid organization name';
  end if;
  if coalesce(p_slug,'') !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
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
$$;
revoke all on function public.create_organization(text,text) from public, anon;
grant execute on function public.create_organization(text,text) to authenticated;
