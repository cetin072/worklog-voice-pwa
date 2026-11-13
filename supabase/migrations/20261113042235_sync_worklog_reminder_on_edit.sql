-- The v2 editor owns the work record and its directly linked schedules.
-- Reminder-created schedules use a separate link and need the same edit transaction.
CREATE OR REPLACE FUNCTION worklog.update_my_work_record_details_v3(p_record_id uuid, p_title text, p_due_at timestamp with time zone, p_due_has_time boolean DEFAULT false, p_action_kind text DEFAULT NULL::text)
 RETURNS TABLE(record_id uuid, title_value text, due_at_value timestamp with time zone, due_has_time boolean, action_kind_value text, action_kind_changed boolean, schedule_updated boolean, schedule_id uuid, schedule_title text, schedule_starts_at timestamp with time zone, schedule_status text, schedule_all_day boolean)
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
declare
  v_details record;
  v_reminder_count integer;
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
begin
  select * into strict v_details
  from worklog.update_my_work_record_details_v2(
    p_record_id, p_title, p_due_at, p_due_has_time, p_action_kind
  );

  -- v2 has already validated ownership and locked the record through its update.
  -- Use the same workspace and lock order as the reminder confirmation RPC.
  select wr.workspace_id into strict v_workspace_id
  from worklog.work_records wr
  where wr.id = v_details.record_id and wr.created_by_user_id = v_user_id;

  update worklog.schedules s
  set title = v_details.title_value,
      starts_at = coalesce(v_details.due_at_value, s.starts_at),
      ends_at = case
        when v_details.due_at_value is null or s.ends_at is null then s.ends_at
        else v_details.due_at_value + (s.ends_at - s.starts_at)
      end,
      all_day = case when v_details.due_at_value is null then s.all_day else not v_details.due_has_time end,
      timezone = case when v_details.due_at_value is null then s.timezone else 'Asia/Seoul' end,
      status = case when v_details.due_at_value is null then 'cancelled' else s.status end,
      updated_at = now()
  where s.workspace_id = v_workspace_id
    and s.created_by_user_id = v_user_id
    and s.metadata ->> 'reminderWorkRecordId' = v_details.record_id::text
    and (s.metadata ->> 'workRecordId') is null
    and s.status in ('confirmed', 'tentative');

  get diagnostics v_reminder_count = row_count;

  return query
  select
    v_details.record_id,
    v_details.title_value,
    v_details.due_at_value,
    v_details.due_has_time,
    v_details.action_kind_value,
    v_details.action_kind_changed,
    v_details.schedule_updated or v_reminder_count > 0,
    linked.id,
    linked.title,
    linked.starts_at,
    linked.status,
    linked.all_day
  from (values (1)) receipt(row_number)
  left join lateral (
    select s.id, s.title, s.starts_at, s.status, s.all_day
    from worklog.schedules s
    where s.workspace_id = v_workspace_id
      and s.created_by_user_id = v_user_id
      and (s.metadata ->> 'workRecordId' = v_details.record_id::text
        or ((s.metadata ->> 'workRecordId') is null
          and s.metadata ->> 'reminderWorkRecordId' = v_details.record_id::text))
    order by (s.status in ('confirmed', 'tentative')) desc, s.updated_at desc, s.id asc
    limit 1
  ) linked on true;
end;
$function$;

revoke all on function worklog.update_my_work_record_details_v3(uuid,text,timestamptz,boolean,text) from public, anon;
grant execute on function worklog.update_my_work_record_details_v3(uuid,text,timestamptz,boolean,text) to authenticated;
