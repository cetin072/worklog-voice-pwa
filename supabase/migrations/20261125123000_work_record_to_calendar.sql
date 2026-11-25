create function worklog.schedule_my_work_record(
  p_owner uuid, p_id uuid, p_title text, p_starts_at timestamptz, p_updated_at timestamptz
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_title text := btrim(coalesce(p_title, ''));
  v_record worklog.work_records;
  v_schedule worklog.schedules;
  v_active_ids uuid[];
begin
  if v_user is null or p_owner is distinct from v_user then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if char_length(v_title) not between 1 and 160 or p_starts_at is null or not isfinite(p_starts_at)
     or (p_starts_at at time zone 'Asia/Seoul')::date not between date '2000-01-01' and date '2099-12-31' then
    raise exception 'INVALID_SCHEDULE';
  end if;

  select wr.* into v_record
  from worklog.work_records wr
  join worklog.workspaces w on w.id = wr.workspace_id
  where wr.id = p_id and w.kind = 'personal' and w.owner_user_id = v_user
    and wr.created_by_user_id = v_user and wr.status in ('in_progress', 'waiting', 'needs_review')
    and not exists (select 1 from worklog.repeating_work rw where rw.work_record_id = wr.id)
  for update of wr;
  if v_record.id is null then
    raise exception 'WORK_NOT_AVAILABLE' using errcode = '42501';
  end if;

  -- Record then schedule is the lock order used by edit and reminder confirmation.
  select array(
    select s.id from worklog.schedules s
    where s.workspace_id = v_record.workspace_id and s.created_by_user_id = v_user
      and s.status in ('confirmed', 'tentative')
      and (s.metadata ->> 'workRecordId' = p_id::text or s.metadata ->> 'reminderWorkRecordId' = p_id::text)
    order by s.id for update
  ) into v_active_ids;
  if cardinality(v_active_ids) > 1 then
    raise exception 'SCHEDULE_LINK_CONFLICT' using errcode = 'PT409';
  end if;
  if cardinality(v_active_ids) = 1 then
    select * into strict v_schedule from worklog.schedules where id = v_active_ids[1];
    if coalesce(v_schedule.metadata ->> 'workRecordId', p_id::text) <> p_id::text
       or coalesce(v_schedule.metadata ->> 'reminderWorkRecordId', p_id::text) <> p_id::text then
      raise exception 'SCHEDULE_LINK_CONFLICT' using errcode = 'PT409';
    end if;
  end if;

  if v_record.action_kind is null then
    -- A retry after a lost response can return the same confirmed schedule.
    if v_record.record_type <> 'meeting_call' or v_record.metadata -> 'actionOverride' ->> 'kind' is distinct from 'schedule'
       or v_record.title is distinct from v_title or v_record.due_at is distinct from p_starts_at
       or v_schedule.status is distinct from 'confirmed' or v_schedule.all_day
       or v_schedule.title is distinct from v_title or v_schedule.starts_at is distinct from p_starts_at then
      raise exception 'VERSION_CONFLICT' using errcode = 'PT409';
    end if;
  else
    if v_record.updated_at is distinct from p_updated_at then
      raise exception 'VERSION_CONFLICT' using errcode = 'PT409';
    end if;
    if v_schedule.id is null then
      insert into worklog.schedules (workspace_id, created_by_user_id, title, description, starts_at, all_day, timezone, status, metadata)
      values (v_record.workspace_id, v_user, v_title, coalesce(v_record.original_text, ''), p_starts_at,
        false, 'Asia/Seoul', 'confirmed', jsonb_build_object('source', 'worklog_edit', 'workRecordId', p_id))
      returning * into v_schedule;
    else
      update worklog.schedules s
      set title = v_title, starts_at = p_starts_at, ends_at = p_starts_at + (s.ends_at - s.starts_at),
        all_day = false, timezone = 'Asia/Seoul', status = 'confirmed',
        metadata = s.metadata || jsonb_build_object('workRecordId', p_id), updated_at = now()
      where s.id = v_schedule.id returning * into v_schedule;
    end if;

    update worklog.work_records
    set title = v_title, action_kind = null, record_type = 'meeting_call', due_at = p_starts_at,
      next_attention_at = null, updated_at = now(),
      metadata = v_record.metadata || jsonb_build_object(
        'dueTimeExplicit', true,
        'actionOverride', jsonb_build_object('kind', 'schedule', 'source', 'user_edit', 'updatedAt', now()),
        'actionEngine', coalesce(v_record.metadata -> 'actionEngine', '{}'::jsonb)
          || jsonb_build_object('kind', 'schedule', 'actionKind', null)
      )
    where id = v_record.id;
  end if;

  return jsonb_build_object('recordId', v_record.id, 'schedule', jsonb_build_object(
    'id', v_schedule.id, 'title', v_schedule.title, 'startsAt', v_schedule.starts_at,
    'status', v_schedule.status, 'allDay', v_schedule.all_day
  ));
end;
$$;

revoke all on function worklog.schedule_my_work_record(uuid, uuid, text, timestamptz, timestamptz) from public, anon;
grant execute on function worklog.schedule_my_work_record(uuid, uuid, text, timestamptz, timestamptz) to authenticated;
