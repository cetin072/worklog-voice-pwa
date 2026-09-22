-- Issue #437: owner-scoped soft delete for briefing records.
-- WorkRecords remain retained for audit/history, but cancelled records are
-- excluded from briefing/journal projections. Linked schedules are cancelled
-- in the same database transaction so an unwanted record cannot leave a live schedule.

create or replace function public.cancel_my_work_record(p_record_id uuid)
returns table (
  record_id uuid,
  status_value text,
  already_cancelled boolean,
  cancelled_schedule_ids uuid[]
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
  v_record_id uuid;
  v_previous_status text;
  v_cancelled_schedule_ids uuid[] := '{}'::uuid[];
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

  select wr.id, wr.status
    into v_record_id, v_previous_status
  from public.work_records wr
  where wr.id = p_record_id
    and wr.workspace_id = v_workspace_id
    and wr.created_by_user_id = v_user_id
  limit 1;

  if v_record_id is null then
    raise exception 'WORK_RECORD_NOT_FOUND_OR_FORBIDDEN';
  end if;

  update public.schedules s
  set status = 'cancelled',
      updated_at = now()
  where s.workspace_id = v_workspace_id
    and s.created_by_user_id = v_user_id
    and s.metadata ->> 'workRecordId' = p_record_id::text
    and s.status in ('confirmed', 'tentative');

  select coalesce(array_agg(s.id order by s.id), '{}'::uuid[])
    into v_cancelled_schedule_ids
  from public.schedules s
  where s.workspace_id = v_workspace_id
    and s.created_by_user_id = v_user_id
    and s.metadata ->> 'workRecordId' = p_record_id::text
    and s.status = 'cancelled';

  if v_previous_status <> 'cancelled' then
    update public.work_records wr
    set status = 'cancelled',
        next_attention_at = null,
        briefing_state = 'acknowledged',
        updated_at = now()
    where wr.id = v_record_id
      and wr.workspace_id = v_workspace_id
      and wr.created_by_user_id = v_user_id;
  end if;

  return query
  select v_record_id, 'cancelled'::text, v_previous_status = 'cancelled', v_cancelled_schedule_ids;
end;
$$;

revoke all on function public.cancel_my_work_record(uuid) from public, anon;
grant execute on function public.cancel_my_work_record(uuid) to authenticated, service_role;
