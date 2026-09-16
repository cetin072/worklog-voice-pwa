-- Issue #258: persist a clear timed event as a Schedule in the same authenticated transaction as its WorkRecord.
-- Deadline-only work stays a WorkRecord due_at and passes null schedule arguments.

create or replace function public.save_my_worklog_with_schedule(
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
  schedule_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
  v_work_record_id uuid;
  v_source_ref_id uuid;
  v_schedule_id uuid;
  v_request_id text := btrim(coalesce(p_client_request_id, ''));
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  if char_length(v_request_id) < 16 or char_length(v_request_id) > 100 then
    raise exception 'CLIENT_REQUEST_ID_INVALID';
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

  insert into public.work_records (
    workspace_id,
    created_by_user_id,
    client_request_id,
    title,
    content,
    original_text,
    record_type,
    status,
    institution,
    amount,
    follow_up,
    recorded_at,
    due_at,
    metadata
  ) values (
    v_workspace_id,
    v_user_id,
    v_request_id,
    p_title,
    coalesce(p_content, ''),
    coalesce(p_original_text, ''),
    p_record_type,
    p_status,
    nullif(btrim(coalesce(p_institution, '')), ''),
    p_amount,
    nullif(btrim(coalesce(p_follow_up, '')), ''),
    p_recorded_at,
    p_due_at,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict on constraint work_records_workspace_client_request_id_key
  do update set
    title = excluded.title,
    content = excluded.content,
    original_text = excluded.original_text,
    record_type = excluded.record_type,
    status = excluded.status,
    institution = excluded.institution,
    amount = excluded.amount,
    follow_up = excluded.follow_up,
    recorded_at = excluded.recorded_at,
    due_at = excluded.due_at,
    metadata = excluded.metadata
  returning id into v_work_record_id;

  insert into public.source_refs (
    workspace_id,
    created_by_user_id,
    client_request_id,
    entity_type,
    entity_id,
    source_type,
    source_id,
    source_excerpt,
    metadata
  ) values (
    v_workspace_id,
    v_user_id,
    v_request_id,
    'work_record',
    v_work_record_id::text,
    'direct',
    v_request_id,
    p_source_excerpt,
    jsonb_build_object('source', 'quick_worklog')
  )
  on conflict on constraint source_refs_workspace_client_request_id_key
  do update set
    entity_type = excluded.entity_type,
    entity_id = excluded.entity_id,
    source_type = excluded.source_type,
    source_id = excluded.source_id,
    source_excerpt = excluded.source_excerpt,
    metadata = excluded.metadata
  returning id into v_source_ref_id;

  if p_schedule_starts_at is not null then
    if p_schedule_title is null or char_length(btrim(p_schedule_title)) < 1 or char_length(btrim(p_schedule_title)) > 200 then
      raise exception 'SCHEDULE_TITLE_INVALID';
    end if;

    select s.id
    into v_schedule_id
    from public.schedules s
    where s.workspace_id = v_workspace_id
      and s.metadata ->> 'source' = 'quick_worklog'
      and s.metadata ->> 'sourceRequestId' = v_request_id
    order by s.created_at asc
    limit 1;

    if v_schedule_id is null then
      insert into public.schedules (
        workspace_id,
        created_by_user_id,
        title,
        description,
        starts_at,
        all_day,
        timezone,
        status,
        metadata
      ) values (
        v_workspace_id,
        v_user_id,
        btrim(p_schedule_title),
        coalesce(p_original_text, ''),
        p_schedule_starts_at,
        false,
        'Asia/Seoul',
        'confirmed',
        jsonb_build_object(
          'source', 'quick_worklog',
          'sourceRequestId', v_request_id,
          'workRecordId', v_work_record_id,
          'sourceRefId', v_source_ref_id
        )
      )
      returning id into v_schedule_id;
    else
      update public.schedules s
      set title = btrim(p_schedule_title),
          description = coalesce(p_original_text, ''),
          starts_at = p_schedule_starts_at,
          all_day = false,
          timezone = 'Asia/Seoul',
          status = case when s.status = 'cancelled' then s.status else 'confirmed' end,
          metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object(
            'source', 'quick_worklog',
            'sourceRequestId', v_request_id,
            'workRecordId', v_work_record_id,
            'sourceRefId', v_source_ref_id
          )
      where s.id = v_schedule_id;
    end if;
  end if;

  return query
  select v_user_id, v_workspace_id, v_work_record_id, v_source_ref_id, v_schedule_id;
end;
$$;

revoke all on function public.save_my_worklog_with_schedule(text, text, text, text, text, text, text, numeric, text, timestamptz, timestamptz, jsonb, text, text, timestamptz) from public, anon;
grant execute on function public.save_my_worklog_with_schedule(text, text, text, text, text, text, text, numeric, text, timestamptz, timestamptz, jsonb, text, text, timestamptz) to authenticated, service_role;
