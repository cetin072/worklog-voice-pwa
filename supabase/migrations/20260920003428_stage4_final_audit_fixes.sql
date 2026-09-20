-- Issue #403 / Stage 4 final audit fixes.
-- Keeps future-only normal attention changes, but makes Undo lossless and stale-write safe.

create or replace function public.postpone_my_work_record(
  p_record_id uuid,
  p_due_at timestamptz,
  p_due_has_time boolean default false
)
returns table(
  record_id uuid,
  due_at_value timestamptz,
  due_has_time boolean,
  previous_due_at_value timestamptz,
  previous_due_has_time boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
  v_previous_due_at timestamptz;
  v_previous_due_has_time boolean;
  v_record_id uuid;
  v_due_at_value timestamptz;
begin
  if v_user_id is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if p_due_at is null then raise exception 'WORK_RECORD_POSTPONE_DUE_REQUIRED'; end if;

  select w.id into v_workspace_id
  from public.workspaces w
  where w.owner_user_id = v_user_id and w.kind = 'personal'
  order by w.created_at asc limit 1;
  if v_workspace_id is null then raise exception 'PERSONAL_WORKSPACE_MISSING'; end if;

  select
    wr.due_at,
    case
      when wr.due_at is null then false
      when coalesce(wr.metadata ->> 'dueTimeExplicit', '') in ('true', 'false') then (wr.metadata ->> 'dueTimeExplicit')::boolean
      else ((wr.due_at at time zone 'Asia/Seoul')::time <> time '00:00')
    end
  into v_previous_due_at, v_previous_due_has_time
  from public.work_records wr
  where wr.id = p_record_id
    and wr.workspace_id = v_workspace_id
    and wr.created_by_user_id = v_user_id
    and wr.status in ('in_progress', 'waiting', 'needs_review')
    and wr.action_kind is distinct from 'note';
  if not found then raise exception 'WORK_RECORD_NOT_FOUND_OR_FORBIDDEN'; end if;

  if exists (
    select 1 from public.schedules s
    where s.workspace_id = v_workspace_id
      and s.created_by_user_id = v_user_id
      and s.metadata ->> 'workRecordId' = p_record_id::text
  ) then raise exception 'WORK_RECORD_POSTPONE_SCHEDULE_LINKED'; end if;

  update public.work_records wr
  set due_at = p_due_at,
      metadata = coalesce(wr.metadata, '{}'::jsonb)
        || jsonb_build_object('dueTimeExplicit', coalesce(p_due_has_time, false))
        || jsonb_build_object('stage4Postpone', jsonb_build_object(
          'previousDueAt', v_previous_due_at,
          'previousDueTimeExplicit', v_previous_due_has_time,
          'appliedDueAt', p_due_at,
          'appliedDueTimeExplicit', coalesce(p_due_has_time, false),
          'changedAt', now()
        )),
      updated_at = now()
  where wr.id = p_record_id
    and wr.workspace_id = v_workspace_id
    and wr.created_by_user_id = v_user_id
  returning wr.id, wr.due_at into v_record_id, v_due_at_value;

  return query select v_record_id, v_due_at_value, coalesce(p_due_has_time, false), v_previous_due_at, v_previous_due_has_time;
end;
$$;

create or replace function public.undo_my_work_record_postpone(p_record_id uuid)
returns table(record_id uuid, due_at_value timestamptz, due_has_time boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
  v_previous_due_at timestamptz;
  v_previous_due_has_time boolean;
  v_applied_due_at timestamptz;
  v_applied_due_has_time boolean;
  v_current_due_at timestamptz;
  v_current_due_has_time boolean;
  v_record_id uuid;
  v_due_at_value timestamptz;
begin
  if v_user_id is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;

  select w.id into v_workspace_id
  from public.workspaces w
  where w.owner_user_id = v_user_id and w.kind = 'personal'
  order by w.created_at asc limit 1;
  if v_workspace_id is null then raise exception 'PERSONAL_WORKSPACE_MISSING'; end if;

  select
    wr.due_at,
    case
      when wr.due_at is null then false
      when coalesce(wr.metadata ->> 'dueTimeExplicit', '') in ('true', 'false') then (wr.metadata ->> 'dueTimeExplicit')::boolean
      else ((wr.due_at at time zone 'Asia/Seoul')::time <> time '00:00')
    end,
    nullif(wr.metadata #>> '{stage4Postpone,previousDueAt}', '')::timestamptz,
    coalesce((wr.metadata #>> '{stage4Postpone,previousDueTimeExplicit}')::boolean, false),
    nullif(wr.metadata #>> '{stage4Postpone,appliedDueAt}', '')::timestamptz,
    coalesce((wr.metadata #>> '{stage4Postpone,appliedDueTimeExplicit}')::boolean, false)
  into v_current_due_at, v_current_due_has_time,
       v_previous_due_at, v_previous_due_has_time,
       v_applied_due_at, v_applied_due_has_time
  from public.work_records wr
  where wr.id = p_record_id
    and wr.workspace_id = v_workspace_id
    and wr.created_by_user_id = v_user_id
    and wr.status in ('in_progress', 'waiting', 'needs_review')
    and wr.action_kind is distinct from 'note'
    and wr.metadata ? 'stage4Postpone';
  if not found or v_applied_due_at is null then raise exception 'WORK_RECORD_POSTPONE_UNDO_UNAVAILABLE'; end if;

  if v_current_due_at is distinct from v_applied_due_at
     or v_current_due_has_time is distinct from v_applied_due_has_time then
    raise exception 'WORK_RECORD_POSTPONE_UNDO_STALE';
  end if;

  update public.work_records wr
  set due_at = v_previous_due_at,
      metadata = (coalesce(wr.metadata, '{}'::jsonb) - 'stage4Postpone')
        || jsonb_build_object('dueTimeExplicit', v_previous_due_has_time),
      updated_at = now()
  where wr.id = p_record_id
    and wr.workspace_id = v_workspace_id
    and wr.created_by_user_id = v_user_id
  returning wr.id, wr.due_at into v_record_id, v_due_at_value;

  return query select v_record_id, v_due_at_value, v_previous_due_has_time;
end;
$$;

create or replace function public.undo_my_work_record_attention(
  p_record_id uuid,
  p_expected_attention_at timestamptz default null,
  p_previous_attention_at timestamptz default null
)
returns table(record_id uuid, next_attention_at_value timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
  v_current_attention_at timestamptz;
  v_record_id uuid;
  v_next_attention_at timestamptz;
begin
  if v_user_id is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;

  select w.id into v_workspace_id
  from public.workspaces w
  where w.owner_user_id = v_user_id and w.kind = 'personal'
  order by w.created_at asc limit 1;
  if v_workspace_id is null then raise exception 'PERSONAL_WORKSPACE_MISSING'; end if;

  select wr.next_attention_at
  into v_current_attention_at
  from public.work_records wr
  where wr.id = p_record_id
    and wr.workspace_id = v_workspace_id
    and wr.created_by_user_id = v_user_id
    and wr.status in ('in_progress', 'waiting', 'needs_review')
    and wr.action_kind is distinct from 'note';
  if not found then raise exception 'WORK_RECORD_NOT_FOUND_OR_FORBIDDEN'; end if;

  if v_current_attention_at is distinct from p_expected_attention_at then
    raise exception 'WORK_RECORD_ATTENTION_UNDO_STALE';
  end if;

  update public.work_records wr
  set next_attention_at = p_previous_attention_at,
      updated_at = now()
  where wr.id = p_record_id
    and wr.workspace_id = v_workspace_id
    and wr.created_by_user_id = v_user_id
  returning wr.id, wr.next_attention_at into v_record_id, v_next_attention_at;

  return query select v_record_id, v_next_attention_at;
end;
$$;

revoke all on function public.postpone_my_work_record(uuid,timestamptz,boolean) from public, anon;
grant execute on function public.postpone_my_work_record(uuid,timestamptz,boolean) to authenticated, service_role;

revoke all on function public.undo_my_work_record_postpone(uuid) from public, anon;
grant execute on function public.undo_my_work_record_postpone(uuid) to authenticated, service_role;

revoke all on function public.undo_my_work_record_attention(uuid,timestamptz,timestamptz) from public, anon;
grant execute on function public.undo_my_work_record_attention(uuid,timestamptz,timestamptz) to authenticated, service_role;
