-- Issue #382 / Stage 3-7: editable Task <-> Note classification.
-- V2 RPCs keep the existing edit RPC signatures intact for older clients.

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
    (
      (wr.metadata #>> '{actionEngine,kind}') is distinct from 'schedule'
      and not exists (
        select 1
        from public.schedules linked_schedule
        where linked_schedule.workspace_id = wr.workspace_id
          and linked_schedule.metadata ->> 'workRecordId' = wr.id::text
      )
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
  schedule_updated boolean,
  action_kind_value text,
  action_changed boolean,
  action_conversion_allowed boolean
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
  v_existing_action_kind text;
  v_existing_metadata jsonb;
  v_conversion_allowed boolean := false;
  v_next_action_kind text;
  v_action_changed boolean := false;
  v_next_metadata jsonb;
  v_record_id uuid;
  v_title_value text;
  v_due_at_value timestamptz;
  v_action_kind_value text;
  v_schedule_count integer := 0;
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

  if p_action_kind is not null and p_action_kind not in ('task', 'note') then
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

  select
    wr.action_kind,
    coalesce(wr.metadata, '{}'::jsonb),
    (
      (wr.metadata #>> '{actionEngine,kind}') is distinct from 'schedule'
      and not exists (
        select 1
        from public.schedules linked_schedule
        where linked_schedule.workspace_id = wr.workspace_id
          and linked_schedule.metadata ->> 'workRecordId' = wr.id::text
      )
    )
  into v_existing_action_kind, v_existing_metadata, v_conversion_allowed
  from public.work_records wr
  where wr.id = p_record_id
    and wr.workspace_id = v_workspace_id
    and wr.created_by_user_id = v_user_id
  for update;

  if not found then
    raise exception 'WORK_RECORD_NOT_FOUND_OR_FORBIDDEN';
  end if;

  v_next_action_kind := coalesce(p_action_kind, v_existing_action_kind);
  v_action_changed := p_action_kind is not null and p_action_kind is distinct from v_existing_action_kind;

  if v_action_changed and not v_conversion_allowed then
    raise exception 'WORK_RECORD_ACTION_CONVERSION_FORBIDDEN';
  end if;

  v_next_metadata := v_existing_metadata || jsonb_build_object('dueTimeExplicit', v_due_has_time);
  if v_action_changed then
    v_next_metadata := jsonb_set(
      v_next_metadata,
      '{actionEngine}',
      coalesce(v_next_metadata -> 'actionEngine', '{}'::jsonb)
        || jsonb_build_object(
          'kind', v_next_action_kind,
          'actionKind', v_next_action_kind,
          'classificationSource', 'user',
          'userOverride', true
        ),
      true
    );
  end if;

  update public.work_records wr
  set title = v_title,
      due_at = p_due_at,
      action_kind = v_next_action_kind,
      briefing_state = case when v_action_changed then 'active' else wr.briefing_state end,
      metadata = v_next_metadata,
      updated_at = now()
  where wr.id = p_record_id
    and wr.workspace_id = v_workspace_id
    and wr.created_by_user_id = v_user_id
  returning wr.id, wr.title, wr.due_at, wr.action_kind
  into v_record_id, v_title_value, v_due_at_value, v_action_kind_value;

  if v_record_id is null then
    raise exception 'WORK_RECORD_NOT_FOUND_OR_FORBIDDEN';
  end if;

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
    (v_schedule_count > 0),
    v_action_kind_value,
    v_action_changed,
    v_conversion_allowed;
end;
$$;

revoke all on function public.get_my_work_record_edit_v2(uuid) from public, anon;
grant execute on function public.get_my_work_record_edit_v2(uuid) to authenticated, service_role;

revoke all on function public.update_my_work_record_details_v2(uuid,text,timestamptz,boolean,text) from public, anon;
grant execute on function public.update_my_work_record_details_v2(uuid,text,timestamptz,boolean,text) to authenticated, service_role;
