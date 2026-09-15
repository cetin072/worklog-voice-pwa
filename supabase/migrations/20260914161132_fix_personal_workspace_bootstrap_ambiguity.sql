-- Issue #144: forward-fix the #125 Personal Workspace bootstrap function.
-- Do not rewrite the already-applied migration; replace only the function body.

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
  on conflict on constraint workspace_members_pkey
  do update set role = 'owner';

  return query select v_workspace_id;
end;
$$;

revoke all on function private.ensure_personal_workspace_for_user(uuid) from public, anon, authenticated;
