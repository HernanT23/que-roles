-- Keep SECURITY DEFINER authorization helpers outside the exposed Data API schema.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter function public.is_org_member(uuid) set schema private;
alter function public.has_org_role(uuid, public.org_role[]) set schema private;

revoke all on function private.is_org_member(uuid) from public, anon;
revoke all on function private.has_org_role(uuid, public.org_role[]) from public, anon;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.has_org_role(uuid, public.org_role[]) to authenticated;

-- The organization bootstrap RPC is intentionally callable by signed-in users only.
revoke all on function public.create_organization(text, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;
