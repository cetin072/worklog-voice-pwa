-- Issue #221: collapse authenticated WorkRecord status mutation into one RPC.
-- Status mapping remains in application code; RLS and creator ownership stay authoritative.

create or replace function public.update_my_work_record_status(
  p_record_id uuid,
  p_status text
)
returns table (
  record_id uuid,
  status_value text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  if p_status not in ('in_progress', 'completed', 'waiting', 'needs_review') then
    raise exception 'WORK_RECORD_STATUS_INVALID';
  end if;

  select w.id
  into v_workspace_id
  from public.workspaces w
  where w.owner_user_id = v_user_id
    and w.kind = 'personal'
  order by w.created_at asc
  limit 1;

  if v_workspace_id is null then
    raise exception 'PERSONAL_WORKSPACE_MISSING';
  end if;

  return query
  update public.work_records wr
  set status = p_status
  where wr.id = p_record_id
    and wr.workspace_id = v_workspace_id
    and wr.created_by_user_id = v_user_id
  returning wr.id, wr.status;
end;
$$;

revoke all on function public.update_my_work_record_status(uuid, text) from public, anon;
grant execute on function public.update_my_work_record_status(uuid, text) to authenticated, service_role;
