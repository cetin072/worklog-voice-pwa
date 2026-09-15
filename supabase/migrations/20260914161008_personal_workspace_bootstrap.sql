-- Issue #125: Supabase Auth users receive exactly one personal workspace.
-- The trigger covers new signups; the public RPC safely repairs/initializes
-- existing authenticated users after sign-in without accepting a user id.

create unique index workspaces_one_personal_per_owner_idx
on public.workspaces (owner_user_id)
where kind = 'personal';

create or replace function private.ensure_personal_workspace_for_user(p_user_id uuid)
returns table (workspace_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  if p_user_id is null then
    raise exception 'PERSONAL_WORKSPACE_USER_REQUIRED';
  end if;

  insert into public.workspaces (name, kind, owner_user_id, created_by_user_id)
  values ('내 업무', 'personal', p_user_id, p_user_id)
  on conflict (owner_user_id) where kind = 'personal' do nothing
  returning id into v_workspace_id;

  if v_workspace_id is null then
    select w.id
    into v_workspace_id
    from public.workspaces w
    where w.owner_user_id = p_user_id
      and w.kind = 'personal';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, p_user_id, 'owner')
  on conflict (workspace_id, user_id)
  do update set role = 'owner';

  return query select v_workspace_id;
end;
$$;

create or replace function private.ensure_current_user_personal_workspace()
returns table (workspace_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  return query
  select e.workspace_id
  from private.ensure_personal_workspace_for_user(v_user_id) e;
end;
$$;

create or replace function private.bootstrap_personal_workspace_on_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.ensure_personal_workspace_for_user(new.id);
  return new;
end;
$$;

create or replace function public.bootstrap_personal_workspace()
returns table (workspace_id uuid)
language sql
security invoker
set search_path = ''
as $$
  select e.workspace_id
  from private.ensure_current_user_personal_workspace() e;
$$;

revoke all on function private.ensure_personal_workspace_for_user(uuid) from public, anon, authenticated;
revoke all on function private.ensure_current_user_personal_workspace() from public, anon;
revoke all on function private.bootstrap_personal_workspace_on_auth_user() from public, anon, authenticated;
revoke all on function public.bootstrap_personal_workspace() from public, anon;

grant execute on function private.ensure_current_user_personal_workspace() to authenticated, service_role;
grant execute on function public.bootstrap_personal_workspace() to authenticated, service_role;

drop trigger if exists auth_user_personal_workspace_bootstrap on auth.users;
create trigger auth_user_personal_workspace_bootstrap
after insert on auth.users
for each row execute function private.bootstrap_personal_workspace_on_auth_user();
