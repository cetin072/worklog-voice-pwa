-- Issue #382 / Stage 3-7: Note <-> Task conversion through the existing edit flow.
-- Keep v1 edit RPCs intact for deployment compatibility. V2 adds action_kind
-- read/update and rejects any WorkRecord that is linked to a Schedule.

create or replace function public.get_my_work_record_edit_v2(p_record_id uuid)
returns table(
  record_id uuid,
  title_value text,
  due_at_value timestamptz,
  due_has_time boolean,
  action_kind_value text,
  action_conversion_allowed boolean
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
  select
    wr.id,
    wr.title,
    wr.due_at,
    case
      when wr.due_at is null then false
      when coalesce(wr.metadata ->> 'dueTimeExplicit', '') in ('true','false')
        then (wr.metadata ->> 'dueTimeExplicit')::boolean
      else ((wr.due_at at time zone 'Asia/Seoul')::time <> time '00:00')
    end,
    wr.action_kind,
    not exists (
      select 1
      from public.schedules s
      where s.workspace_id = v_workspace_id
        and s.created_by_user_id = v_user_id
        and s.metadata ->> 'workRecordId' = wr.id::text
    )
  from public.work_records wr
  where wr.id = p_record_id
    and wr.workspace_id = v_workspace_id
    and wr.created_by_user_id = v_user_id;

  if not found then
    raise exception 'WORK_RECORD_NOT_FOUND_OR_FORBIDDEN';
  end if;
end;
$$;

create or replace function public.update_my_work_record_details_v2(
  p_record_id uuid,
  p_title text,
  p_due_at timestamptz,
  p_due_has_time boolean default false,
  p_action_kind text default null
)
returns table(
  record_id uuid,
  title_value text,
  due_at_value timestamptz,
  due_has_time boolean,
  action_kind_value text,
  action_kind_changed boolean,
  schedule_updated boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
  v_title text := btrim(coalesce(p_title, ''));
  v_due_has_time boolean := case when p_due_at is null then false else coalesce(p_due_has_time, false) end;
  v_action_kind text := case when p_action_kind is null then null else lower(btrim(p_action_kind)) end;
  v_previous_action_kind text;
  v_record_id uuid;
  v_title_value text;
  v_due_at_value timestamptz;
  v_action_kind_value text;
  v_schedule_count integer := 0;
  v_has_linked_schedule boolean := false;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  if char_length(v_title) < 1 or char_length(v_title) > 160 then
    raise exception 'WORK_RECORD_TITLE_INVALID';
  end if;

  if p_due_at is null and coalesce(p_due_has_time, false) then
    raise exception 'WORK_RECORD_DUE_INVALID';
  end if;

  if v_action_kind is not null and v_action_kind not in ('task', 'note') then
    raise exception 'WORK_RECORD_ACTION_KIND_INVALID';
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

  select wr.action_kind,
    exists (
      select 1
      from public.schedules s
      where s.workspace_id = v_workspace_id
        and s.created_by_user_id = v_user_id
        and s.metadata ->> 'workRecordId' = wr.id::text
    )
  into v_previous_action_kind, v_has_linked_schedule
  from public.work_records wr
  where wr.id = p_record_id
    and wr.workspace_id = v_workspace_id
    and wr.created_by_user_id = v_user_id;

  if not found then
    raise exception 'WORK_RECORD_NOT_FOUND_OR_FORBIDDEN';
  end if;

  if v_action_kind is not null
     and v_action_kind is distinct from v_previous_action_kind
     and v_has_linked_schedule then
    raise exception 'WORK_RECORD_ACTION_CONVERSION_SCHEDULE_LINKED';
  end if;

  update public.work_records wr
  set title = v_title,
      due_at = p_due_at,
      action_kind = coalesce(v_action_kind, wr.action_kind),
      briefing_state = case
        when v_action_kind in ('task', 'note') and v_action_kind is distinct from wr.action_kind then 'active'
        else wr.briefing_state
      end,
      metadata = coalesce(wr.metadata, '{}'::jsonb)
        || jsonb_build_object('dueTimeExplicit', v_due_has_time)
        || case
          when v_action_kind in ('task', 'note') then jsonb_build_object(
            'actionOverride',
            jsonb_build_object(
              'kind', v_action_kind,
              'source', 'user_edit',
              'updatedAt', now()
            )
          )
          else '{}'::jsonb
        end,
      updated_at = now()
  where wr.id = p_record_id
    and wr.workspace_id = v_workspace_id
    and wr.created_by_user_id = v_user_id
  returning wr.id, wr.title, wr.due_at, wr.action_kind
  into v_record_id, v_title_value, v_due_at_value, v_action_kind_value;

  if v_record_id is null then
    raise exception 'WORK_RECORD_NOT_FOUND_OR_FORBIDDEN';
  end if;

  -- Existing linked Schedule title/time sync remains supported for non-conversion
  -- edits. Conversion itself is blocked above when any linked Schedule exists.
  update public.schedules s
  set title = v_title,
      starts_at = case when p_due_at is null then s.starts_at else p_due_at end,
      all_day = case when p_due_at is null then s.all_day else not v_due_has_time end,
      timezone = case when p_due_at is null then s.timezone else 'Asia/Seoul' end,
      status = case
        when p_due_at is null then 'cancelled'
        when s.status = 'cancelled' then s.status
        else 'confirmed'
      end,
      updated_at = now()
  where s.workspace_id = v_workspace_id
    and s.created_by_user_id = v_user_id
    and s.metadata ->> 'workRecordId' = p_record_id::text;

  get diagnostics v_schedule_count = row_count;

  return query
  select
    v_record_id,
    v_title_value,
    v_due_at_value,
    v_due_has_time,
    v_action_kind_value,
    (v_action_kind is not null and v_action_kind is distinct from v_previous_action_kind),
    (v_schedule_count > 0);
end;
$$;

revoke all on function public.get_my_work_record_edit_v2(uuid) from public, anon;
grant execute on function public.get_my_work_record_edit_v2(uuid) to authenticated, service_role;

revoke all on function public.update_my_work_record_details_v2(uuid,text,timestamptz,boolean,text) from public, anon;
grant execute on function public.update_my_work_record_details_v2(uuid,text,timestamptz,boolean,text) to authenticated, service_role;
