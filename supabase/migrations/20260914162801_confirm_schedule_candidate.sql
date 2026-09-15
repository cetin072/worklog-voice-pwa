-- Issue #143: atomically confirm a reviewed ScheduleCandidate into a Data Core Schedule.
-- The function is SECURITY INVOKER so existing Workspace RLS remains authoritative.

create or replace function public.confirm_schedule_candidate(p_candidate_id uuid)
returns table (candidate_id uuid, schedule_id uuid, candidate_status text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_candidate public.candidates%rowtype;
  v_schedule_id uuid;
  v_existing_schedule_id uuid;
  v_title text;
  v_description text;
  v_starts_text text;
  v_ends_text text;
  v_reminder_text text;
  v_timezone text;
  v_location text;
  v_schedule_status text;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_reminder_at timestamptz;
  v_all_day boolean := false;
begin
  if (select auth.uid()) is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;

  if p_candidate_id is null then
    raise exception 'SCHEDULE_CANDIDATE_ID_REQUIRED' using errcode = '22023';
  end if;

  select c.*
    into v_candidate
  from public.candidates c
  where c.id = p_candidate_id
  for update;

  if not found then
    raise exception 'SCHEDULE_CANDIDATE_NOT_FOUND_OR_FORBIDDEN' using errcode = 'P0002';
  end if;

  if v_candidate.candidate_type <> 'schedule' then
    raise exception 'SCHEDULE_CANDIDATE_TYPE_REQUIRED' using errcode = '22023';
  end if;

  if v_candidate.status = 'confirmed' then
    if v_candidate.confirmed_entity_type <> 'schedule' or nullif(btrim(v_candidate.confirmed_entity_id), '') is null then
      raise exception 'SCHEDULE_CANDIDATE_CONFIRMATION_BROKEN' using errcode = '23514';
    end if;

    begin
      v_existing_schedule_id := v_candidate.confirmed_entity_id::uuid;
    exception when invalid_text_representation then
      raise exception 'SCHEDULE_CANDIDATE_CONFIRMATION_BROKEN' using errcode = '23514';
    end;

    select s.id
      into v_schedule_id
    from public.schedules s
    where s.id = v_existing_schedule_id
      and s.workspace_id = v_candidate.workspace_id;

    if v_schedule_id is null then
      raise exception 'SCHEDULE_CANDIDATE_CONFIRMED_ENTITY_MISSING' using errcode = 'P0002';
    end if;

    return query select v_candidate.id, v_schedule_id, 'confirmed'::text;
    return;
  end if;

  if v_candidate.status <> 'pending' then
    raise exception 'SCHEDULE_CANDIDATE_NOT_PENDING' using errcode = '55000';
  end if;

  v_title := nullif(btrim(v_candidate.title), '');
  if v_title is null then
    raise exception 'SCHEDULE_CANDIDATE_TITLE_REQUIRED' using errcode = '23514';
  end if;

  v_starts_text := nullif(btrim(v_candidate.payload ->> 'startsAt'), '');
  if v_starts_text is null then
    raise exception 'SCHEDULE_CANDIDATE_START_REQUIRED' using errcode = '23514';
  end if;

  begin
    v_starts_at := v_starts_text::timestamptz;
  exception when others then
    raise exception 'SCHEDULE_CANDIDATE_START_INVALID' using errcode = '22007';
  end;

  v_ends_text := nullif(btrim(v_candidate.payload ->> 'endsAt'), '');
  if v_ends_text is not null then
    begin
      v_ends_at := v_ends_text::timestamptz;
    exception when others then
      raise exception 'SCHEDULE_CANDIDATE_END_INVALID' using errcode = '22007';
    end;
  end if;

  v_reminder_text := nullif(btrim(v_candidate.payload ->> 'reminderAt'), '');
  if v_reminder_text is not null then
    begin
      v_reminder_at := v_reminder_text::timestamptz;
    exception when others then
      raise exception 'SCHEDULE_CANDIDATE_REMINDER_INVALID' using errcode = '22007';
    end;
  end if;

  if v_candidate.payload ? 'allDay' then
    if jsonb_typeof(v_candidate.payload -> 'allDay') <> 'boolean' then
      raise exception 'SCHEDULE_CANDIDATE_ALL_DAY_INVALID' using errcode = '22023';
    end if;
    v_all_day := (v_candidate.payload ->> 'allDay')::boolean;
  end if;

  v_timezone := coalesce(nullif(btrim(v_candidate.payload ->> 'timezone'), ''), 'Asia/Seoul');
  v_location := nullif(btrim(v_candidate.payload ->> 'location'), '');
  v_description := coalesce(v_candidate.payload ->> 'description', '');
  v_schedule_status := coalesce(nullif(btrim(v_candidate.payload ->> 'status'), ''), 'confirmed');

  if v_schedule_status not in ('confirmed', 'tentative') then
    raise exception 'SCHEDULE_CANDIDATE_STATUS_INVALID' using errcode = '22023';
  end if;

  insert into public.schedules (
    workspace_id,
    created_by_user_id,
    title,
    description,
    starts_at,
    ends_at,
    all_day,
    timezone,
    status,
    location,
    reminder_at,
    metadata
  ) values (
    v_candidate.workspace_id,
    (select auth.uid()),
    v_title,
    v_description,
    v_starts_at,
    v_ends_at,
    v_all_day,
    v_timezone,
    v_schedule_status,
    v_location,
    v_reminder_at,
    jsonb_strip_nulls(jsonb_build_object(
      'source', 'candidate_confirmation',
      'sourceCandidateId', v_candidate.id,
      'sourceRefId', v_candidate.source_ref_id
    ))
  )
  returning id into v_schedule_id;

  update public.candidates c
  set status = 'confirmed',
      confirmed_entity_type = 'schedule',
      confirmed_entity_id = v_schedule_id::text,
      confirmed_at = now(),
      updated_at = now()
  where c.id = v_candidate.id
    and c.workspace_id = v_candidate.workspace_id;

  if not found then
    raise exception 'SCHEDULE_CANDIDATE_CONFIRM_UPDATE_FAILED' using errcode = 'P0002';
  end if;

  return query select v_candidate.id, v_schedule_id, 'confirmed'::text;
end;
$$;

revoke all on function public.confirm_schedule_candidate(uuid) from public, anon, authenticated;
grant execute on function public.confirm_schedule_candidate(uuid) to authenticated;
