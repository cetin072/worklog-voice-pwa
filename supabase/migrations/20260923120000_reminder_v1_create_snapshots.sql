-- Issue #446: return the committed Schedule snapshot with the save result.
-- Mobile must never depend on a post-commit REST read before acknowledging a save.

create or replace function public.save_my_worklog_with_schedule_v2(
  p_client_request_id text,
  p_title text,
  p_content text,
  p_original_text text,
  p_record_type text,
  p_status text,
  p_institution text default null,
  p_amount numeric default null,
  p_follow_up text default null,
  p_recorded_at timestamptz default now(),
  p_due_at timestamptz default null,
  p_metadata jsonb default '{}'::jsonb,
  p_source_excerpt text default null,
  p_schedule_title text default null,
  p_schedule_starts_at timestamptz default null
)
returns table (
  user_id uuid,
  workspace_id uuid,
  work_record_id uuid,
  source_ref_id uuid,
  schedule_id uuid,
  title text,
  starts_at timestamptz,
  status text,
  all_day boolean
)
language sql
security invoker
set search_path = ''
as $$
  select saved.user_id, saved.workspace_id, saved.work_record_id, saved.source_ref_id, saved.schedule_id,
    schedule.title, schedule.starts_at, schedule.status, schedule.all_day
  from public.save_my_worklog_with_schedule(
    p_client_request_id, p_title, p_content, p_original_text, p_record_type, p_status,
    p_institution, p_amount, p_follow_up, p_recorded_at, p_due_at, p_metadata,
    p_source_excerpt, p_schedule_title, p_schedule_starts_at
  ) saved
  left join public.schedules schedule
    on schedule.id = saved.schedule_id
    and schedule.workspace_id = saved.workspace_id
    and schedule.created_by_user_id = saved.user_id;
$$;

revoke all on function public.save_my_worklog_with_schedule_v2(text, text, text, text, text, text, text, numeric, text, timestamptz, timestamptz, jsonb, text, text, timestamptz) from public, anon;
grant execute on function public.save_my_worklog_with_schedule_v2(text, text, text, text, text, text, text, numeric, text, timestamptz, timestamptz, jsonb, text, text, timestamptz) to authenticated, service_role;

create or replace function public.save_my_multi_action_worklog_v2(
  p_parent_request_id text,
  p_original_text text,
  p_source_type text default 'direct',
  p_recorded_at timestamptz default now(),
  p_capture_metadata jsonb default '{}'::jsonb,
  p_items jsonb default '[]'::jsonb
)
returns table (
  capture_id uuid,
  saved_count integer,
  work_record_ids uuid[],
  source_ref_ids uuid[],
  schedule_ids uuid[],
  schedule_snapshots jsonb
)
language sql
security invoker
set search_path = ''
as $$
  select saved.capture_id, saved.saved_count, saved.work_record_ids, saved.source_ref_ids, saved.schedule_ids,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', schedule.id,
        'title', schedule.title,
        'startsAt', schedule.starts_at,
        'status', schedule.status,
        'allDay', schedule.all_day
      ) order by array_position(saved.schedule_ids, schedule.id))
      from public.schedules schedule
      where schedule.id = any(saved.schedule_ids)
        and schedule.created_by_user_id = (select auth.uid())
    ), '[]'::jsonb)
  from public.save_my_multi_action_worklog(
    p_parent_request_id, p_original_text, p_source_type, p_recorded_at, p_capture_metadata, p_items
  ) saved;
$$;

revoke all on function public.save_my_multi_action_worklog_v2(text, text, text, timestamptz, jsonb, jsonb) from public, anon;
grant execute on function public.save_my_multi_action_worklog_v2(text, text, text, timestamptz, jsonb, jsonb) to authenticated, service_role;
