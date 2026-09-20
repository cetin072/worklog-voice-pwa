-- Human QA stabilization: make schedule cancellation available in Production and idempotent.
-- Device Calendar / local reminder cleanup remains a mobile responsibility.

create or replace function public.cancel_my_schedule(p_schedule_id uuid)
returns table (
  schedule_id uuid,
  schedule_status text,
  already_cancelled boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
  v_schedule_id uuid;
  v_schedule_status text;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED';
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

  select s.id, s.status
    into v_schedule_id, v_schedule_status
  from public.schedules s
  where s.id = p_schedule_id
    and s.workspace_id = v_workspace_id
    and s.created_by_user_id = v_user_id
  limit 1;

  if v_schedule_id is null then
    raise exception 'SCHEDULE_NOT_FOUND_OR_FORBIDDEN';
  end if;

  if v_schedule_status = 'cancelled' then
    return query select v_schedule_id, v_schedule_status, true;
    return;
  end if;

  if v_schedule_status not in ('confirmed', 'tentative') then
    raise exception 'SCHEDULE_CANCEL_INVALID_STATE';
  end if;

  update public.schedules s
  set status = 'cancelled',
      updated_at = now()
  where s.id = v_schedule_id
    and s.workspace_id = v_workspace_id
    and s.created_by_user_id = v_user_id
    and s.status in ('confirmed', 'tentative')
  returning s.status into v_schedule_status;

  if v_schedule_status is distinct from 'cancelled' then
    raise exception 'SCHEDULE_CANCEL_STALE';
  end if;

  return query select v_schedule_id, v_schedule_status, false;
end;
$$;

revoke all on function public.cancel_my_schedule(uuid) from public, anon;
grant execute on function public.cancel_my_schedule(uuid) to authenticated, service_role;
