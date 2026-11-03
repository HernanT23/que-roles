-- Acceso con usuario real (cédula o nombre de usuario + contraseña) e invitaciones por código.
-- 1) La membresía basta para acceder: ya no se exige una sesión anónima.
create or replace function private.is_org_member(p_org uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.organization_memberships m
    where m.organization_id = p_org and m.user_id = auth.uid());
$$;

create or replace function private.has_org_role(p_org uuid, p_roles public.org_role[])
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.organization_memberships m
    where m.organization_id = p_org and m.user_id = auth.uid() and m.role = any(p_roles));
$$;

revoke all on function private.is_org_member(uuid) from public, anon;
revoke all on function private.has_org_role(uuid, public.org_role[]) from public, anon;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.has_org_role(uuid, public.org_role[]) to authenticated;

-- 2) Invitaciones: el dueño genera un código de un solo uso; la otra persona crea su usuario y lo canjea.
create table if not exists public.org_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role public.org_role not null,
  code_hash text not null unique,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by uuid references auth.users(id),
  used_at timestamptz
);
alter table public.org_invites enable row level security;
revoke all on public.org_invites from anon, authenticated, public;
grant all on public.org_invites to service_role;

create or replace function public.create_invite(p_organization_id uuid, p_role text)
returns text
language plpgsql security definer
set search_path = public, private, pg_temp
as $$
declare v_code text;
begin
  if auth.uid() is null or not private.has_org_role(p_organization_id, array['owner','admin']::public.org_role[]) then
    raise exception 'No tienes permiso para invitar personas';
  end if;
  if p_role not in ('admin','manager','cashier','production') then raise exception 'Rol inválido'; end if;
  v_code := upper(substr(replace(gen_random_uuid()::text,'-',''), 1, 10));
  insert into public.org_invites(organization_id, role, code_hash, created_by)
  values (p_organization_id, p_role::public.org_role, encode(sha256(convert_to(v_code,'UTF8')),'hex'), auth.uid());
  return v_code;
end;
$$;
revoke all on function public.create_invite(uuid,text) from public, anon;
grant execute on function public.create_invite(uuid,text) to authenticated;

create or replace function public.redeem_invite(p_code text)
returns uuid
language plpgsql security definer
set search_path = public, private, pg_temp
as $$
declare inv public.org_invites%rowtype;
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero'; end if;
  select * into inv from public.org_invites
   where code_hash = encode(sha256(convert_to(upper(trim(coalesce(p_code,''))),'UTF8')),'hex')
     and used_at is null and expires_at > now()
   for update;
  if not found then raise exception 'Código inválido o vencido'; end if;
  insert into public.organization_memberships(organization_id, user_id, role)
  values (inv.organization_id, auth.uid(), inv.role)
  on conflict do nothing;
  update public.org_invites set used_by = auth.uid(), used_at = now() where id = inv.id;
  return inv.organization_id;
end;
$$;
revoke all on function public.redeem_invite(text) from public, anon;
grant execute on function public.redeem_invite(text) to authenticated;
