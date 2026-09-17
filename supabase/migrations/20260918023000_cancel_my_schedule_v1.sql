-- Mobile schedule cancellation is a soft state transition, never a hard delete.
-- Device-calendar events and local notifications are reconciled by the mobile client.

create or replace function public.cancel_my_schedule(p_schedule_id uuid)
returns table (
  schedule_id uuid,
  schedule_status text
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

  update public.schedules s
  set status = 'cancelled',
      updated_at = now()
  where s.id = p_schedule_id
    and s.workspace_id = v_workspace_id
    and s.created_by_user_id = v_user_id
    and s.status in ('confirmed', 'tentative')
  returning s.id, s.status
  into v_schedule_id, v_schedule_status;

  if v_schedule_id is null then
    raise exception 'SCHEDULE_NOT_FOUND_OR_FORBIDDEN';
  end if;

  return query select v_schedule_id, v_schedule_status;
end;
$$;

revoke all on function public.cancel_my_schedule(uuid) from public, anon;
grant execute on function public.cancel_my_schedule(uuid) to authenticated, service_role;
