-- Issue #267: preserve capture provenance without creating a second WorkRecord writer.
-- Existing callers keep the same function signatures. sourceType is carried inside p_metadata.

create or replace function public.save_my_worklog(
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
  p_source_excerpt text default null
)
returns table (
  user_id uuid,
  workspace_id uuid,
  work_record_id uuid,
  source_ref_id uuid
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
  v_requested_institution_source text := lower(coalesce(
    p_metadata #>> '{fieldProvenance,institution}',
    p_metadata #>> '{field_provenance,institution}',
    p_metadata ->> 'institutionSource',
    p_metadata ->> 'institution_source',
    ''
  ));
  v_institution_source text;
  v_institution text;
  v_source_type text := case
    when lower(coalesce(p_metadata ->> 'sourceType', p_metadata ->> 'source_type', 'direct')) = 'capture' then 'capture'
    else 'direct'
  end;
  v_source_label text;
  v_metadata jsonb;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  if p_client_request_id is null
    or char_length(btrim(p_client_request_id)) < 16
    or char_length(btrim(p_client_request_id)) > 100 then
    raise exception 'CLIENT_REQUEST_ID_INVALID';
  end if;

  v_institution_source := case
    when nullif(btrim(coalesce(p_institution, '')), '') is null then 'unset'
    when v_requested_institution_source in ('user_selected', 'user_confirmed') then v_requested_institution_source
    else 'unverified'
  end;

  v_institution := case
    when v_institution_source in ('user_selected', 'user_confirmed')
      then nullif(btrim(coalesce(p_institution, '')), '')
    else null
  end;

  v_source_label := case when v_source_type = 'capture' then 'capture' else 'quick_worklog' end;

  v_metadata := coalesce(p_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'source', v_source_label,
      'sourceType', v_source_type,
      'fieldProvenance',
      coalesce(p_metadata -> 'fieldProvenance', '{}'::jsonb)
        || jsonb_build_object('institution', v_institution_source)
    );

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
    btrim(p_client_request_id),
    p_title,
    coalesce(p_content, ''),
    coalesce(p_original_text, ''),
    p_record_type,
    p_status,
    v_institution,
    p_amount,
    nullif(btrim(coalesce(p_follow_up, '')), ''),
    p_recorded_at,
    p_due_at,
    v_metadata
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
    btrim(p_client_request_id),
    'work_record',
    v_work_record_id::text,
    v_source_type,
    btrim(p_client_request_id),
    p_source_excerpt,
    jsonb_build_object(
      'source', v_source_label,
      'sourceType', v_source_type,
      'fieldProvenance', jsonb_build_object('institution', v_institution_source)
    )
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

  return query
  select v_user_id, v_workspace_id, v_work_record_id, v_source_ref_id;
end;
$$;

revoke all on function public.save_my_worklog(text, text, text, text, text, text, text, numeric, text, timestamptz, timestamptz, jsonb, text) from public, anon;
grant execute on function public.save_my_worklog(text, text, text, text, text, text, text, numeric, text, timestamptz, timestamptz, jsonb, text) to authenticated, service_role;

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
  v_request_id text := btrim(coalesce(p_client_request_id, ''));
  v_user_id uuid;
  v_workspace_id uuid;
  v_work_record_id uuid;
  v_source_ref_id uuid;
  v_schedule_id uuid;
  v_source_type text := case
    when lower(coalesce(p_metadata ->> 'sourceType', p_metadata ->> 'source_type', 'direct')) = 'capture' then 'capture'
    else 'direct'
  end;
  v_source_label text;
begin
  if char_length(v_request_id) < 16 or char_length(v_request_id) > 100 then
    raise exception 'CLIENT_REQUEST_ID_INVALID';
  end if;

  v_source_label := case when v_source_type = 'capture' then 'capture' else 'quick_worklog' end;

  select r.user_id, r.workspace_id, r.work_record_id, r.source_ref_id
  into v_user_id, v_workspace_id, v_work_record_id, v_source_ref_id
  from public.save_my_worklog(
    v_request_id, p_title, p_content, p_original_text, p_record_type, p_status,
    p_institution, p_amount, p_follow_up, p_recorded_at, p_due_at, p_metadata, p_source_excerpt
  ) r;

  if v_user_id is null or v_workspace_id is null or v_work_record_id is null or v_source_ref_id is null then
    raise exception 'WORKLOG_SAVE_RESULT_INVALID';
  end if;

  if p_schedule_starts_at is not null then
    if p_schedule_title is null or char_length(btrim(p_schedule_title)) < 1 or char_length(btrim(p_schedule_title)) > 200 then
      raise exception 'SCHEDULE_TITLE_INVALID';
    end if;

    select s.id into v_schedule_id
    from public.schedules s
    where s.workspace_id = v_workspace_id
      and s.created_by_user_id = v_user_id
      and s.metadata ->> 'source' = v_source_label
      and s.metadata ->> 'sourceRequestId' = v_request_id
    order by s.created_at asc limit 1;

    if v_schedule_id is null then
      insert into public.schedules (
        workspace_id, created_by_user_id, title, description, starts_at, all_day, timezone, status, metadata
      ) values (
        v_workspace_id, v_user_id, btrim(p_schedule_title), coalesce(p_original_text, ''), p_schedule_starts_at,
        false, 'Asia/Seoul', 'confirmed',
        jsonb_build_object('source', v_source_label, 'sourceType', v_source_type, 'sourceRequestId', v_request_id,
          'workRecordId', v_work_record_id, 'sourceRefId', v_source_ref_id)
      ) returning id into v_schedule_id;
    else
      update public.schedules s
      set title = btrim(p_schedule_title), description = coalesce(p_original_text, ''), starts_at = p_schedule_starts_at,
          all_day = false, timezone = 'Asia/Seoul',
          status = case when s.status = 'cancelled' then s.status else 'confirmed' end,
          metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object(
            'source', v_source_label, 'sourceType', v_source_type, 'sourceRequestId', v_request_id,
            'workRecordId', v_work_record_id, 'sourceRefId', v_source_ref_id)
      where s.id = v_schedule_id
        and s.workspace_id = v_workspace_id
        and s.created_by_user_id = v_user_id;
    end if;
  end if;

  return query select v_user_id, v_workspace_id, v_work_record_id, v_source_ref_id, v_schedule_id;
end;
$$;

revoke all on function public.save_my_worklog_with_schedule(text, text, text, text, text, text, text, numeric, text, timestamptz, timestamptz, jsonb, text, text, timestamptz) from public, anon;
grant execute on function public.save_my_worklog_with_schedule(text, text, text, text, text, text, text, numeric, text, timestamptz, timestamptz, jsonb, text, text, timestamptz) to authenticated, service_role;
