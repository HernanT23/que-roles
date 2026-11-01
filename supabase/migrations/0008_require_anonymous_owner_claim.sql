-- The private Que Roles instance uses one anonymous owner session.
-- Require Supabase's signed is_anonymous JWT claim in tenant authorization helpers.
create or replace function private.is_org_member(p_org uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    and exists (select 1 from public.organization_memberships m
      where m.organization_id=p_org and m.user_id=auth.uid());
$$;

create or replace function private.has_org_role(p_org uuid, p_roles public.org_role[])
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    and exists (select 1 from public.organization_memberships m
      where m.organization_id=p_org and m.user_id=auth.uid() and m.role=any(p_roles));
$$;

revoke all on function private.is_org_member(uuid) from public,anon;
revoke all on function private.has_org_role(uuid,public.org_role[]) from public,anon;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.has_org_role(uuid,public.org_role[]) to authenticated;