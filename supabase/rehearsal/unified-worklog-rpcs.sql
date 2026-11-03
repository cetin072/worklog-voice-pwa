-- REHEARSAL ONLY. Apply after unified-worklog-catalog.sql in an isolated DB.
-- Adapted current functions; no Auth trigger or source scheduler credential.
CREATE OR REPLACE FUNCTION worklog_private.apply_work_record_action_journal_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.journal_date is null then
    new.journal_date := (coalesce(new.recorded_at, now()) at time zone 'Asia/Seoul')::date;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'completed' and new.completed_at is null then
      new.completed_at := now();
    end if;
    if new.briefing_state = 'acknowledged' and new.acknowledged_at is null then
      new.acknowledged_at := now();
    end if;
    return new;
  end if;

  if new.status = 'completed' and old.status is distinct from 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status is distinct from 'completed' and old.status = 'completed' then
    new.completed_at := null;
  end if;

  if new.briefing_state = 'acknowledged'
     and old.briefing_state is distinct from 'acknowledged' then
    new.acknowledged_at := coalesce(new.acknowledged_at, now());
  elsif new.briefing_state = 'active'
        and old.briefing_state = 'acknowledged' then
    new.acknowledged_at := null;
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION worklog_private.backfill_work_record_normalization_baseline(p_limit integer DEFAULT 25)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
  v_inserted integer := 0;
begin
  with candidates as (
    select wr.*
    from worklog.work_records wr
    left join worklog.work_record_normalizations n
      on n.work_record_id = wr.id
    where n.work_record_id is null
    order by wr.created_at asc, wr.id asc
    limit v_limit
  ), inserted as (
    insert into worklog.work_record_normalizations (
      work_record_id,
      workspace_id,
      created_by_user_id,
      processing_status,
      normalized_title,
      normalized_text,
      structured_data,
      search_aliases,
      confidence,
      review_state,
      normalization_version,
      source_quality,
      normalized_at
    )
    select
      c.id,
      c.workspace_id,
      c.created_by_user_id,
      case
        when nullif(btrim(c.original_text), '') is null then 'needs_review'
        else 'completed'
      end,
      left(c.title, 200),
      left(coalesce(
        nullif(btrim(c.content), ''),
        nullif(btrim(c.original_text), ''),
        c.title
      ), 10000),
      jsonb_strip_nulls(jsonb_build_object(
        'institution', nullif(btrim(coalesce(c.institution, '')), ''),
        'dueAt', c.due_at,
        'status', c.status,
        'recordType', c.record_type,
        'followUp', c.follow_up,
        'entities', '[]'::jsonb,
        'sourceQuality', case
          when nullif(btrim(c.original_text), '') is null then 'fallback_content'
          else 'original'
        end
      )),
      case
        when nullif(btrim(coalesce(c.institution, '')), '') is null then '{}'::text[]
        else array[btrim(c.institution)]::text[]
      end,
      case
        when nullif(btrim(c.original_text), '') is null then 0.5500
        else 0.9000
      end,
      case
        when nullif(btrim(c.original_text), '') is null then 'needs_review'
        else 'unreviewed'
      end,
      'baseline-backfill-v0',
      case
        when nullif(btrim(c.original_text), '') is null then 'fallback_content'
        else 'original'
      end,
      now()
    from candidates c
    on conflict (work_record_id) do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end;
$function$
;
CREATE OR REPLACE FUNCTION worklog_private.can_access_workspace(p_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.account_status='active')
    and (select auth.uid()) is not null
    and (
      exists (
        select 1
        from worklog.workspaces w
        where w.id = p_workspace_id
          and w.owner_user_id = (select auth.uid())
      )
      or exists (
        select 1
        from worklog.workspace_members wm
        where wm.workspace_id = p_workspace_id
          and wm.user_id = (select auth.uid())
      )
    );
$function$
;
CREATE OR REPLACE FUNCTION worklog_private.enqueue_work_record_normalization()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  insert into worklog.work_record_normalizations (
    work_record_id,
    workspace_id,
    created_by_user_id,
    processing_status,
    source_quality
  ) values (
    new.id,
    new.workspace_id,
    new.created_by_user_id,
    'pending',
    case when nullif(btrim(new.original_text), '') is null then 'fallback_content' else 'original' end
  )
  on conflict (work_record_id) do nothing;
  return new;
end;
$function$
;
create or replace function worklog_private.ensure_current_user_personal_workspace() returns table(workspace_id uuid) language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
 if not exists(select 1 from public.profiles where id=auth.uid() and account_status='active') then raise exception 'WORKLOG_ACCESS_NOT_PROVISIONED'; end if;
 return query select w.id from worklog.workspaces w join worklog.workspace_members m on m.workspace_id=w.id and m.user_id=auth.uid() and m.role='owner' where w.kind='personal' and w.owner_user_id=auth.uid();
 if not found then raise exception 'WORKLOG_ACCESS_NOT_PROVISIONED'; end if;
end; $$;
CREATE OR REPLACE FUNCTION worklog_private.ensure_personal_workspace_for_user(p_user_id uuid)
 RETURNS TABLE(workspace_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_workspace_id uuid;
begin
  if p_user_id is null then
    raise exception 'PERSONAL_WORKSPACE_USER_REQUIRED';
  end if;

  insert into worklog.workspaces (name, kind, owner_user_id, created_by_user_id)
  values ('내 업무', 'personal', p_user_id, p_user_id)
  on conflict (owner_user_id) where kind = 'personal' do nothing
  returning id into v_workspace_id;

  if v_workspace_id is null then
    select w.id
    into v_workspace_id
    from worklog.workspaces w
    where w.owner_user_id = p_user_id
      and w.kind = 'personal';
  end if;

  insert into worklog.workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, p_user_id, 'owner')
  on conflict on constraint workspace_members_pkey
  do update set role = 'owner';

  return query select v_workspace_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION worklog_private.is_workspace_owner(p_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.account_status='active')
    and (select auth.uid()) is not null
    and exists (
      select 1
      from worklog.workspaces w
      where w.id = p_workspace_id
        and w.owner_user_id = (select auth.uid())
    );
$function$
;
CREATE OR REPLACE FUNCTION worklog_private.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
create or replace function worklog._notification_scheduler_secret_ok(p_secret text) returns boolean language sql stable security definer set search_path='' as $$ select false $$;
CREATE OR REPLACE FUNCTION worklog.bootstrap_personal_workspace()
 RETURNS TABLE(workspace_id uuid)
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select e.workspace_id
  from worklog_private.ensure_current_user_personal_workspace() e;
$function$
;
CREATE OR REPLACE FUNCTION worklog.cancel_my_schedule(p_schedule_id uuid)
 RETURNS TABLE(schedule_id uuid, schedule_status text, already_cancelled boolean)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
  v_schedule_id uuid;
  v_schedule_status text;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  select w.id
    into v_workspace_id
  from worklog.workspaces w
  where w.owner_user_id = v_user_id
    and w.kind = 'personal'
  order by w.created_at asc
  limit 1;

  if v_workspace_id is null then
    raise exception 'PERSONAL_WORKSPACE_MISSING';
  end if;

  select s.id, s.status
    into v_schedule_id, v_schedule_status
  from worklog.schedules s
  where s.id = p_schedule_id
    and s.workspace_id = v_workspace_id
    and s.created_by_user_id = v_user_id
  limit 1;

  if v_schedule_id is null then
    raise exception 'SCHEDULE_NOT_FOUND_OR_FORBIDDEN';
  end if;

  if v_schedule_status = 'cancelled' then
    return query select v_schedule_id, v_schedule_status, true;
    return;
  end if;

  if v_schedule_status not in ('confirmed', 'tentative') then
    raise exception 'SCHEDULE_CANCEL_INVALID_STATE';
  end if;

  update worklog.schedules s
  set status = 'cancelled',
      updated_at = now()
  where s.id = v_schedule_id
    and s.workspace_id = v_workspace_id
    and s.created_by_user_id = v_user_id
    and s.status in ('confirmed', 'tentative')
  returning s.status into v_schedule_status;

  if v_schedule_status is distinct from 'cancelled' then
    raise exception 'SCHEDULE_CANCEL_STALE';
  end if;

  return query select v_schedule_id, v_schedule_status, false;
end;
$function$
;
CREATE OR REPLACE FUNCTION worklog.cancel_my_work_record(p_record_id uuid)
 RETURNS TABLE(record_id uuid, status_value text, already_cancelled boolean, cancelled_schedule_ids uuid[])
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  from worklog.workspaces w
  where w.owner_user_id = v_user_id
    and w.kind = 'personal'
  order by w.created_at asc
  limit 1;

  if v_workspace_id is null then
    raise exception 'PERSONAL_WORKSPACE_MISSING';
  end if;

  select wr.id, wr.status
    into v_record_id, v_previous_status
  from worklog.work_records wr
  where wr.id = p_record_id
    and wr.workspace_id = v_workspace_id
    and wr.created_by_user_id = v_user_id
  limit 1 for update;

  if v_record_id is null then
    raise exception 'WORK_RECORD_NOT_FOUND_OR_FORBIDDEN';
  end if;

  update worklog.schedules s
  set status = 'cancelled',
      updated_at = now()
  where s.workspace_id = v_workspace_id
    and s.created_by_user_id = v_user_id
    and (s.metadata ->> 'workRecordId' = p_record_id::text or s.metadata ->> 'reminderWorkRecordId' = p_record_id::text)
    and s.status in ('confirmed', 'tentative');

  select coalesce(array_agg(s.id order by s.id), '{}'::uuid[])
    into v_cancelled_schedule_ids
  from worklog.schedules s
  where s.workspace_id = v_workspace_id
    and s.created_by_user_id = v_user_id
    and (s.metadata ->> 'workRecordId' = p_record_id::text or s.metadata ->> 'reminderWorkRecordId' = p_record_id::text)
    and s.status = 'cancelled';

  if v_previous_status <> 'cancelled' then
    update worklog.work_records wr
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
$function$
;
CREATE OR REPLACE FUNCTION worklog.claim_afternoon_notification_deliveries(p_scheduler_secret text, p_app_origin text, p_local_date date DEFAULT NULL::date)
 RETURNS TABLE(delivery_id uuid, subscription_id uuid, endpoint text, p256dh text, auth_secret text, today_count integer, overdue_count integer, schedule_count integer, morning_detail_enabled boolean, primary_work_title text, primary_work_bucket text, primary_schedule_title text, primary_schedule_time text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'worklog', 'extensions'
AS $function$
declare
  v_local_date date := coalesce(p_local_date, (now() at time zone 'Asia/Seoul')::date);
begin
  if not worklog._notification_scheduler_secret_ok(p_scheduler_secret) then
    raise exception 'notification scheduler authentication failed' using errcode = '42501';
  end if;
  if p_app_origin is null or p_app_origin !~ '^https://[^/]+$' then
    raise exception 'notification app origin invalid' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select
      ps.id as subscription_id,
      ps.workspace_id,
      ps.user_id,
      ps.endpoint,
      ps.p256dh,
      ps.auth_secret,
      coalesce(work_counts.today_count, 0)::integer as today_count,
      coalesce(work_counts.overdue_count, 0)::integer as overdue_count,
      0::integer as schedule_count,
      np.morning_detail_enabled,
      work_focus.primary_work_title,
      work_focus.primary_work_bucket,
      null::text as primary_schedule_title,
      null::text as primary_schedule_time
    from worklog.notification_preferences np
    join worklog.push_subscriptions ps
      on ps.workspace_id = np.workspace_id
     and ps.user_id = np.user_id
     and ps.disabled_at is null
     and ps.app_origin = p_app_origin
    left join lateral (
      select
        count(*) filter (
          where wr.due_at is not null
            and (wr.due_at at time zone 'Asia/Seoul')::date = v_local_date
        ) as today_count,
        count(*) filter (
          where wr.due_at is not null
            and (wr.due_at at time zone 'Asia/Seoul')::date < v_local_date
        ) as overdue_count
      from worklog.work_records wr
      where wr.workspace_id = np.workspace_id
        and wr.status in ('in_progress','waiting','needs_review')
        and coalesce(wr.metadata->>'project', '') not in ('SYSTEM_DAILY_BRIEFING','SYSTEM_SPLIT_SOURCE','SYSTEM_TEST')
    ) work_counts on true
    left join lateral (
      select
        btrim(wr.title) as primary_work_title,
        case
          when (wr.due_at at time zone 'Asia/Seoul')::date < v_local_date then 'overdue'
          else 'today'
        end as primary_work_bucket
      from worklog.work_records wr
      where wr.workspace_id = np.workspace_id
        and wr.status in ('in_progress','waiting','needs_review')
        and wr.due_at is not null
        and (wr.due_at at time zone 'Asia/Seoul')::date <= v_local_date
        and coalesce(wr.metadata->>'project', '') not in ('SYSTEM_DAILY_BRIEFING','SYSTEM_SPLIT_SOURCE','SYSTEM_TEST')
      order by
        case when (wr.due_at at time zone 'Asia/Seoul')::date < v_local_date then 0 else 1 end,
        wr.due_at asc,
        wr.updated_at desc
      limit 1
    ) work_focus on true
    where np.afternoon_enabled = true
      and np.afternoon_time = time '16:30'
      and np.timezone = 'Asia/Seoul'
  ),
  eligible as (
    select c.*
    from candidates c
    where c.today_count + c.overdue_count > 0
  ),
  inserted as (
    insert into worklog.notification_deliveries as nd (
      workspace_id, user_id, subscription_id, kind, local_date, status, metadata
    )
    select
      e.workspace_id,
      e.user_id,
      e.subscription_id,
      'afternoon_incomplete',
      v_local_date,
      'pending',
      jsonb_build_object(
        'todayCount', e.today_count,
        'overdueCount', e.overdue_count,
        'detailEnabled', e.morning_detail_enabled
      )
    from eligible e
    on conflict on constraint notification_deliveries_subscription_id_kind_local_date_key do nothing
    returning nd.id, nd.subscription_id
  )
  select
    i.id,
    e.subscription_id,
    e.endpoint,
    e.p256dh,
    e.auth_secret,
    e.today_count,
    e.overdue_count,
    e.schedule_count,
    e.morning_detail_enabled,
    e.primary_work_title,
    e.primary_work_bucket,
    e.primary_schedule_title,
    e.primary_schedule_time
  from inserted i
  join eligible e on e.subscription_id = i.subscription_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION worklog.claim_morning_notification_deliveries(p_scheduler_secret text, p_app_origin text, p_local_date date DEFAULT NULL::date)
 RETURNS TABLE(delivery_id uuid, subscription_id uuid, endpoint text, p256dh text, auth_secret text, today_count integer, overdue_count integer, schedule_count integer, morning_detail_enabled boolean, primary_work_title text, primary_work_bucket text, primary_schedule_title text, primary_schedule_time text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'worklog', 'extensions'
AS $function$
declare
  v_local_date date := coalesce(p_local_date, (now() at time zone 'Asia/Seoul')::date);
begin
  if not worklog._notification_scheduler_secret_ok(p_scheduler_secret) then
    raise exception 'notification scheduler authentication failed' using errcode = '42501';
  end if;
  if p_app_origin is null or p_app_origin !~ '^https://[^/]+$' then
    raise exception 'notification app origin invalid' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select
      ps.id as subscription_id,
      ps.workspace_id,
      ps.user_id,
      ps.endpoint,
      ps.p256dh,
      ps.auth_secret,
      coalesce(work_counts.today_count, 0)::integer as today_count,
      coalesce(work_counts.overdue_count, 0)::integer as overdue_count,
      coalesce(schedule_counts.schedule_count, 0)::integer as schedule_count,
      np.morning_detail_enabled,
      work_focus.primary_work_title,
      work_focus.primary_work_bucket,
      schedule_focus.primary_schedule_title,
      schedule_focus.primary_schedule_time
    from worklog.notification_preferences np
    join worklog.push_subscriptions ps
      on ps.workspace_id = np.workspace_id
     and ps.user_id = np.user_id
     and ps.disabled_at is null
     and ps.app_origin = p_app_origin
    left join lateral (
      select
        count(*) filter (
          where (wr.due_at at time zone 'Asia/Seoul')::date = v_local_date
        ) as today_count,
        count(*) filter (
          where (wr.due_at at time zone 'Asia/Seoul')::date < v_local_date
        ) as overdue_count
      from worklog.work_records wr
      where wr.workspace_id = np.workspace_id
        and wr.status in ('in_progress','waiting','needs_review')
        and coalesce(wr.metadata->>'project', '') not in ('SYSTEM_DAILY_BRIEFING','SYSTEM_SPLIT_SOURCE','SYSTEM_TEST')
    ) work_counts on true
    left join lateral (
      select count(*) as schedule_count
      from worklog.schedules s
      where s.workspace_id = np.workspace_id
        and s.status in ('confirmed','tentative')
        and s.starts_at >= (v_local_date::timestamp at time zone 'Asia/Seoul')
        and s.starts_at < ((v_local_date + 1)::timestamp at time zone 'Asia/Seoul')
    ) schedule_counts on true
    left join lateral (
      select
        btrim(wr.title) as primary_work_title,
        case
          when (wr.due_at at time zone 'Asia/Seoul')::date < v_local_date then 'overdue'
          else 'today'
        end as primary_work_bucket
      from worklog.work_records wr
      where wr.workspace_id = np.workspace_id
        and wr.status in ('in_progress','waiting','needs_review')
        and wr.due_at is not null
        and (wr.due_at at time zone 'Asia/Seoul')::date <= v_local_date
        and coalesce(wr.metadata->>'project', '') not in ('SYSTEM_DAILY_BRIEFING','SYSTEM_SPLIT_SOURCE','SYSTEM_TEST')
      order by
        case when (wr.due_at at time zone 'Asia/Seoul')::date < v_local_date then 0 else 1 end,
        wr.due_at asc,
        wr.updated_at desc
      limit 1
    ) work_focus on true
    left join lateral (
      select
        btrim(s.title) as primary_schedule_title,
        case
          when s.all_day then '종일'
          else to_char(s.starts_at at time zone 'Asia/Seoul', 'HH24:MI')
        end as primary_schedule_time
      from worklog.schedules s
      where s.workspace_id = np.workspace_id
        and s.status in ('confirmed','tentative')
        and s.starts_at >= (v_local_date::timestamp at time zone 'Asia/Seoul')
        and s.starts_at < ((v_local_date + 1)::timestamp at time zone 'Asia/Seoul')
      order by s.starts_at asc, s.updated_at desc
      limit 1
    ) schedule_focus on true
    where np.morning_enabled = true
      and np.morning_time = time '08:30'
      and np.timezone = 'Asia/Seoul'
  ),
  eligible as (
    select c.* from candidates c
    where c.today_count + c.overdue_count + c.schedule_count > 0
  ),
  inserted as (
    insert into worklog.notification_deliveries as nd (
      workspace_id, user_id, subscription_id, kind, local_date, status, metadata
    )
    select
      e.workspace_id,
      e.user_id,
      e.subscription_id,
      'morning_digest',
      v_local_date,
      'pending',
      jsonb_build_object(
        'todayCount', e.today_count,
        'overdueCount', e.overdue_count,
        'scheduleCount', e.schedule_count,
        'detailEnabled', e.morning_detail_enabled
      )
    from eligible e
    on conflict on constraint notification_deliveries_subscription_id_kind_local_date_key do nothing
    returning nd.id, nd.subscription_id
  )
  select
    i.id,
    e.subscription_id,
    e.endpoint,
    e.p256dh,
    e.auth_secret,
    e.today_count,
    e.overdue_count,
    e.schedule_count,
    e.morning_detail_enabled,
    e.primary_work_title,
    e.primary_work_bucket,
    e.primary_schedule_title,
    e.primary_schedule_time
  from inserted i
  join eligible e on e.subscription_id = i.subscription_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION worklog.clear_irrelevant_work_record_attention()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'worklog'
AS $function$
begin
  if new.status in ('completed', 'cancelled') or new.action_kind = 'note' then
    new.next_attention_at := null;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION worklog.confirm_my_worklog_reminder(p_record_id uuid, p_starts_at timestamp with time zone)
 RETURNS TABLE(schedule_id uuid)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_user uuid := (select auth.uid());
  v_record worklog.work_records%rowtype;
  v_schedule worklog.schedules%rowtype;
begin
  if v_user is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  select wr.* into v_record from worklog.work_records wr
  join worklog.workspaces w on w.id = wr.workspace_id
  where wr.id = p_record_id and wr.created_by_user_id = v_user
    and w.owner_user_id = v_user and w.kind = 'personal'
  for update of wr;
  if v_record.id is null then raise exception 'WORK_RECORD_NOT_FOUND_OR_FORBIDDEN'; end if;
  if v_record.status in ('cancelled', 'completed') then raise exception 'WORK_RECORD_INACTIVE'; end if;
  select s.* into v_schedule from worklog.schedules s
  where s.workspace_id = v_record.workspace_id and s.created_by_user_id = v_user
    and (s.metadata ->> 'workRecordId' = p_record_id::text
      or s.metadata ->> 'reminderWorkRecordId' = p_record_id::text)
  order by s.created_at limit 1 for update;
  if v_schedule.id is not null then
    if v_schedule.status <> 'confirmed' then raise exception 'REMINDER_INACTIVE'; end if;
    if p_starts_at is distinct from v_schedule.starts_at then raise exception 'REMINDER_TIME_CONFLICT'; end if;
    return query select v_schedule.id;
    return;
  end if;
  if p_starts_at is null or not isfinite(p_starts_at) or p_starts_at <= now() then raise exception 'TIME_INVALID'; end if;
  insert into worklog.schedules(workspace_id, created_by_user_id, title, starts_at, all_day, timezone, status, metadata)
  values(v_record.workspace_id, v_user, left(v_record.title, 200), p_starts_at, false, 'Asia/Seoul', 'confirmed',
    jsonb_build_object('source','worklog_reminder','reminderWorkRecordId',p_record_id))
  returning * into v_schedule;
  return query select v_schedule.id;
end;
$function$
;
CREATE OR REPLACE FUNCTION worklog.confirm_schedule_candidate(p_candidate_id uuid)
 RETURNS TABLE(candidate_id uuid, schedule_id uuid, candidate_status text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_candidate worklog.candidates%rowtype;
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
  from worklog.candidates c
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
    from worklog.schedules s
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

  insert into worklog.schedules (
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

  update worklog.candidates c
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
$function$
;
CREATE OR REPLACE FUNCTION worklog.finish_notification_delivery(p_scheduler_secret text, p_delivery_id uuid, p_success boolean, p_status integer DEFAULT NULL::integer, p_code text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'worklog', 'extensions'
AS $function$
declare
  v_subscription_id uuid;
  v_now timestamptz := now();
begin
  if not worklog._notification_scheduler_secret_ok(p_scheduler_secret) then
    raise exception 'notification scheduler authentication failed' using errcode = '42501';
  end if;

  update worklog.notification_deliveries
  set
    status = case when p_success then 'sent' else 'failed' end,
    error_status = case when p_success then null else p_status end,
    error_code = case when p_success then null else left(coalesce(p_code, 'UNKNOWN'), 80) end,
    sent_at = case when p_success then v_now else sent_at end,
    updated_at = v_now
  where id = p_delivery_id
    and status = 'pending'
  returning subscription_id into v_subscription_id;

  if v_subscription_id is null then
    return false;
  end if;

  if p_success then
    update worklog.push_subscriptions
    set last_success_at = v_now,
        last_failure_at = null,
        last_failure_status = null,
        last_failure_code = null,
        updated_at = v_now
    where id = v_subscription_id;
  else
    update worklog.push_subscriptions
    set last_failure_at = v_now,
        last_failure_status = p_status,
        last_failure_code = left(coalesce(p_code, 'UNKNOWN'), 80),
        disabled_at = case when p_status in (404, 410) then v_now else disabled_at end,
        updated_at = v_now
    where id = v_subscription_id;
  end if;

  return true;
end;
$function$
;
CREATE OR REPLACE FUNCTION worklog.get_my_briefing_source()
 RETURNS TABLE(workspace_id uuid, today date, tasks jsonb, notes jsonb, schedules jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with params as (select timezone('Asia/Seoul', now())::date as today),
  my_workspace as (
    select w.id from worklog.workspaces w where w.owner_user_id = (select auth.uid()) and w.kind = 'personal' order by w.created_at asc limit 1
  ),
  task_rows as (
    select wr.id, wr.title, wr.institution, wr.status, wr.follow_up, wr.due_at, wr.next_attention_at, wr.action_kind, wr.updated_at, wr.recorded_at, wr.metadata
    from worklog.work_records wr join my_workspace mw on mw.id = wr.workspace_id
    where wr.status in ('in_progress', 'waiting', 'needs_review') and wr.action_kind is distinct from 'note'
    order by wr.updated_at desc limit 500
  ),
  note_rows as (
    select wr.id, wr.title, wr.institution, wr.status, wr.journal_date, wr.recorded_at, wr.updated_at
    from worklog.work_records wr join my_workspace mw on mw.id = wr.workspace_id
    where wr.action_kind = 'note' and wr.briefing_state = 'active' and wr.status in ('in_progress', 'waiting', 'needs_review')
    order by wr.updated_at desc limit 100
  ),
  schedule_rows as (
    select s.id, s.title, s.starts_at, s.all_day, s.status, s.location
    from worklog.schedules s join my_workspace mw on mw.id = s.workspace_id cross join params p
    where s.status in ('confirmed', 'tentative') and s.starts_at >= (p.today::timestamp at time zone 'Asia/Seoul') and s.starts_at < ((p.today + 15)::timestamp at time zone 'Asia/Seoul')
    order by s.starts_at asc limit 100
  )
  select mw.id, p.today,
    coalesce((select jsonb_agg(to_jsonb(t) order by t.updated_at desc) from task_rows t), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(n) order by n.updated_at desc) from note_rows n), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(s) order by s.starts_at asc) from schedule_rows s), '[]'::jsonb)
  from my_workspace mw cross join params p;
$function$
;
CREATE OR REPLACE FUNCTION worklog.get_my_work_journal_day(p_date date)
 RETURNS TABLE(workspace_id uuid, target_date date, today date, schedules jsonb, completed jsonb, notes jsonb, open_tasks jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with params as (
    select
      coalesce(p_date, timezone('Asia/Seoul', now())::date) as target_date,
      timezone('Asia/Seoul', now())::date as today
  ),
  my_workspace as (
    select w.id
    from worklog.workspaces w
    where w.owner_user_id = (select auth.uid())
      and w.kind = 'personal'
    order by w.created_at asc
    limit 1
  ),
  schedule_rows as (
    select
      s.id,
      s.title,
      s.starts_at,
      s.all_day,
      s.status,
      s.location
    from worklog.schedules s
    join my_workspace mw on mw.id = s.workspace_id
    cross join params p
    where s.status <> 'cancelled'
      and s.starts_at >= (p.target_date::timestamp at time zone 'Asia/Seoul')
      and s.starts_at < ((p.target_date + 1)::timestamp at time zone 'Asia/Seoul')
    order by s.starts_at asc
    limit 200
  ),
  completed_rows as (
    select
      wr.id,
      wr.title,
      wr.institution,
      wr.status,
      wr.follow_up,
      wr.journal_date,
      wr.due_at,
      wr.completed_at,
      wr.recorded_at
    from worklog.work_records wr
    join my_workspace mw on mw.id = wr.workspace_id
    cross join params p
    where wr.status = 'completed'
      and wr.action_kind is distinct from 'note'
      and (wr.metadata #>> '{actionEngine,kind}') is distinct from 'schedule'
      and not exists (
        select 1
        from worklog.schedules linked_schedule
        where linked_schedule.workspace_id = wr.workspace_id
          and linked_schedule.metadata ->> 'workRecordId' = wr.id::text
          and linked_schedule.status <> 'cancelled'
      )
      and (
        (
          wr.completed_at is not null
          and (wr.completed_at at time zone 'Asia/Seoul')::date = p.target_date
        )
        or (
          wr.completed_at is null
          and wr.journal_date = p.target_date
        )
      )
    order by coalesce(wr.completed_at, wr.recorded_at) asc
    limit 500
  ),
  note_rows as (
    select
      wr.id,
      wr.title,
      wr.institution,
      wr.briefing_state,
      wr.journal_date,
      wr.recorded_at,
      wr.updated_at
    from worklog.work_records wr
    join my_workspace mw on mw.id = wr.workspace_id
    cross join params p
    where wr.action_kind = 'note'
      and wr.status <> 'cancelled'
      and wr.journal_date = p.target_date
    order by wr.recorded_at asc
    limit 500
  ),
  open_rows as (
    select
      wr.id,
      wr.title,
      wr.institution,
      wr.status,
      wr.follow_up,
      wr.journal_date,
      wr.due_at,
      wr.recorded_at
    from worklog.work_records wr
    join my_workspace mw on mw.id = wr.workspace_id
    cross join params p
    where wr.status in ('in_progress', 'waiting', 'needs_review')
      and wr.action_kind is distinct from 'note'
      and (wr.metadata #>> '{actionEngine,kind}') is distinct from 'schedule'
      and not exists (
        select 1
        from worklog.schedules linked_schedule
        where linked_schedule.workspace_id = wr.workspace_id
          and linked_schedule.metadata ->> 'workRecordId' = wr.id::text
          and linked_schedule.status <> 'cancelled'
      )
      and (
        case
          when wr.due_at is not null
            then (wr.due_at at time zone 'Asia/Seoul')::date
          else wr.journal_date
        end
      ) = p.target_date
    order by coalesce(wr.due_at, wr.recorded_at) asc
    limit 500
  )
  select
    mw.id,
    p.target_date,
    p.today,
    coalesce(
      (select jsonb_agg(to_jsonb(s) order by s.starts_at asc) from schedule_rows s),
      '[]'::jsonb
    ),
    coalesce(
      (select jsonb_agg(to_jsonb(c) order by coalesce(c.completed_at, c.recorded_at) asc) from completed_rows c),
      '[]'::jsonb
    ),
    coalesce(
      (select jsonb_agg(to_jsonb(n) order by n.recorded_at asc) from note_rows n),
      '[]'::jsonb
    ),
    coalesce(
      (select jsonb_agg(to_jsonb(o) order by coalesce(o.due_at, o.recorded_at) asc) from open_rows o),
      '[]'::jsonb
    )
  from my_workspace mw
  cross join params p;
$function$
;
CREATE OR REPLACE FUNCTION worklog.get_my_work_record_edit(p_record_id uuid)
 RETURNS TABLE(record_id uuid, title_value text, due_at_value timestamp with time zone, due_has_time boolean)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  select w.id
  into v_workspace_id
  from worklog.workspaces w
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
    end
  from worklog.work_records wr
  where wr.id = p_record_id
    and wr.workspace_id = v_workspace_id
    and wr.created_by_user_id = v_user_id;

  if not found then
    raise exception 'WORK_RECORD_NOT_FOUND_OR_FORBIDDEN';
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION worklog.get_my_work_record_edit_v2(p_record_id uuid)
 RETURNS TABLE(record_id uuid, title_value text, due_at_value timestamp with time zone, due_has_time boolean, action_kind_value text, action_conversion_allowed boolean)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  select w.id
  into v_workspace_id
  from worklog.workspaces w
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
    wr.action_kind in ('task', 'note')
    and not exists (
      select 1
      from worklog.schedules s
      where s.workspace_id = v_workspace_id
        and s.created_by_user_id = v_user_id
        and s.metadata ->> 'workRecordId' = wr.id::text
    )
  from worklog.work_records wr
  where wr.id = p_record_id
    and wr.workspace_id = v_workspace_id
    and wr.created_by_user_id = v_user_id;

  if not found then
    raise exception 'WORK_RECORD_NOT_FOUND_OR_FORBIDDEN';
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION worklog.postpone_my_work_record(p_record_id uuid, p_due_at timestamp with time zone, p_due_has_time boolean DEFAULT false)
 RETURNS TABLE(record_id uuid, due_at_value timestamp with time zone, due_has_time boolean, previous_due_at_value timestamp with time zone, previous_due_has_time boolean)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  from worklog.workspaces w
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
  from worklog.work_records wr
  where wr.id = p_record_id
    and wr.workspace_id = v_workspace_id
    and wr.created_by_user_id = v_user_id
    and wr.status in ('in_progress', 'waiting', 'needs_review')
    and wr.action_kind is distinct from 'note';
  if not found then raise exception 'WORK_RECORD_NOT_FOUND_OR_FORBIDDEN'; end if;

  if exists (
    select 1 from worklog.schedules s
    where s.workspace_id = v_workspace_id
      and s.created_by_user_id = v_user_id
      and s.metadata ->> 'workRecordId' = p_record_id::text
  ) then raise exception 'WORK_RECORD_POSTPONE_SCHEDULE_LINKED'; end if;

  update worklog.work_records wr
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
$function$
;
CREATE OR REPLACE FUNCTION worklog.recalculate_shared_cost_allocations(p_month_start date)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_month_end date;
  v_inserted integer := 0;
begin
  if p_month_start is null
     or p_month_start <> date_trunc('month', p_month_start::timestamp)::date then
    raise exception 'SHARED_COST_MONTH_START_INVALID';
  end if;

  v_month_end := (p_month_start + interval '1 month')::date;

  delete from worklog.shared_cost_allocations
  where month_start = p_month_start;

  with active_pairs as (
    select distinct x.user_id, x.workspace_id
    from (
      select ue.user_id, ue.workspace_id
      from worklog.usage_events ue
      where ue.created_at >= p_month_start
        and ue.created_at < v_month_end

      union all

      select wr.created_by_user_id, wr.workspace_id
      from worklog.work_records wr
      where wr.created_by_user_id is not null
        and wr.created_at >= p_month_start
        and wr.created_at < v_month_end

      union all

      select s.created_by_user_id, s.workspace_id
      from worklog.schedules s
      where s.created_by_user_id is not null
        and s.created_at >= p_month_start
        and s.created_at < v_month_end

      union all

      select sr.created_by_user_id, sr.workspace_id
      from worklog.source_refs sr
      where sr.created_by_user_id is not null
        and sr.created_at >= p_month_start
        and sr.created_at < v_month_end

      union all

      select c.created_by_user_id, c.workspace_id
      from worklog.candidates c
      where c.created_by_user_id is not null
        and c.created_at >= p_month_start
        and c.created_at < v_month_end
    ) x
    where x.user_id is not null
  ),
  active_count as (
    select count(*)::numeric as n from active_pairs
  )
  insert into worklog.shared_cost_allocations (
    pool_id,
    month_start,
    user_id,
    workspace_id,
    allocation_method,
    allocation_weight,
    allocated_cost_krw
  )
  select
    p.id,
    p.month_start,
    a.user_id,
    a.workspace_id,
    p.allocation_method,
    (1 / c.n)::numeric(20,12),
    round((p.amount_krw / c.n)::numeric, 6)::numeric(20,6)
  from worklog.shared_cost_pools p
  cross join active_pairs a
  cross join active_count c
  where p.month_start = p_month_start
    and p.allocation_method = 'equal_active_user'
    and c.n > 0;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$function$
;
CREATE OR REPLACE FUNCTION worklog.save_my_multi_action_worklog(p_parent_request_id text, p_original_text text, p_source_type text DEFAULT 'direct'::text, p_recorded_at timestamp with time zone DEFAULT now(), p_capture_metadata jsonb DEFAULT '{}'::jsonb, p_items jsonb DEFAULT '[]'::jsonb)
 RETURNS TABLE(capture_id uuid, saved_count integer, work_record_ids uuid[], source_ref_ids uuid[], schedule_ids uuid[])
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
  v_parent_request_id text := btrim(coalesce(p_parent_request_id, ''));
  v_source_type text := lower(btrim(coalesce(p_source_type, 'direct')));
  v_capture_id uuid;
  v_existing_original text;
  v_existing_source_type text;
  v_item jsonb;
  v_index bigint;
  v_count integer;
  v_child_request_id text;
  v_user_result uuid;
  v_workspace_result uuid;
  v_work_record_id uuid;
  v_source_ref_id uuid;
  v_schedule_id uuid;
  v_work_ids uuid[] := '{}'::uuid[];
  v_source_ids uuid[] := '{}'::uuid[];
  v_schedule_ids uuid[] := '{}'::uuid[];
  v_metadata jsonb;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  if char_length(v_parent_request_id) < 16 or char_length(v_parent_request_id) > 100
     or v_parent_request_id !~ '^[A-Za-z0-9-]+$' then
    raise exception 'MULTI_ACTION_PARENT_REQUEST_ID_INVALID';
  end if;

  if v_source_type not in ('direct', 'voice', 'call', 'meeting', 'mail', 'capture', 'scan', 'notion', 'import', 'other') then
    raise exception 'MULTI_ACTION_SOURCE_TYPE_INVALID';
  end if;

  if char_length(coalesce(p_original_text, '')) > 10000 then
    raise exception 'MULTI_ACTION_ORIGINAL_TOO_LONG';
  end if;

  if jsonb_typeof(coalesce(p_capture_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'MULTI_ACTION_CAPTURE_METADATA_INVALID';
  end if;

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'MULTI_ACTION_ITEMS_INVALID';
  end if;

  v_count := jsonb_array_length(p_items);
  if v_count < 2 or v_count > 8 then
    raise exception 'MULTI_ACTION_ITEM_COUNT_INVALID';
  end if;

  select w.id into v_workspace_id
  from worklog.workspaces w
  where w.owner_user_id = v_user_id
    and w.kind = 'personal'
  order by w.created_at asc
  limit 1;

  if v_workspace_id is null then
    raise exception 'PERSONAL_WORKSPACE_MISSING';
  end if;

  select c.id, c.original_text, c.source_type
  into v_capture_id, v_existing_original, v_existing_source_type
  from worklog.input_captures c
  where c.workspace_id = v_workspace_id
    and c.client_request_id = v_parent_request_id
  limit 1;

  if v_capture_id is not null then
    if v_existing_original is distinct from coalesce(p_original_text, '')
       or v_existing_source_type is distinct from v_source_type then
      raise exception 'MULTI_ACTION_CAPTURE_REQUEST_CONFLICT';
    end if;

    update worklog.input_captures c
    set metadata = coalesce(c.metadata, '{}'::jsonb)
          || coalesce(p_capture_metadata, '{}'::jsonb)
          || jsonb_build_object('segmentCount', v_count)
    where c.id = v_capture_id;
  else
    insert into worklog.input_captures (
      workspace_id,
      created_by_user_id,
      client_request_id,
      source_type,
      original_text,
      recorded_at,
      metadata
    ) values (
      v_workspace_id,
      v_user_id,
      v_parent_request_id,
      v_source_type,
      coalesce(p_original_text, ''),
      p_recorded_at,
      coalesce(p_capture_metadata, '{}'::jsonb)
        || jsonb_build_object('segmentCount', v_count)
    )
    returning id into v_capture_id;
  end if;

  for v_item, v_index in
    select value, ordinality
    from jsonb_array_elements(p_items) with ordinality
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'MULTI_ACTION_ITEM_INVALID';
    end if;

    v_child_request_id := 'multi-' || substr(md5(v_parent_request_id), 1, 24) || '-' || lpad(v_index::text, 2, '0');

    v_metadata := coalesce(v_item -> 'metadata', '{}'::jsonb)
      || jsonb_build_object(
        'inputCapture',
        jsonb_build_object(
          'captureId', v_capture_id,
          'requestId', v_parent_request_id,
          'segmentIndex', v_index,
          'segmentCount', v_count,
          'sourceType', v_source_type
        )
      );

    select r.user_id, r.workspace_id, r.work_record_id, r.source_ref_id, r.schedule_id
    into v_user_result, v_workspace_result, v_work_record_id, v_source_ref_id, v_schedule_id
    from worklog.save_my_worklog_with_schedule(
      v_child_request_id,
      nullif(btrim(coalesce(v_item ->> 'title', '')), ''),
      coalesce(v_item ->> 'content', ''),
      coalesce(v_item ->> 'originalText', ''),
      coalesce(v_item ->> 'recordType', 'other'),
      coalesce(v_item ->> 'status', 'in_progress'),
      nullif(btrim(coalesce(v_item ->> 'institution', '')), ''),
      case
        when nullif(btrim(coalesce(v_item ->> 'amount', '')), '') is null then null
        else (v_item ->> 'amount')::numeric
      end,
      nullif(btrim(coalesce(v_item ->> 'followUp', '')), ''),
      coalesce(nullif(v_item ->> 'recordedAt', '')::timestamptz, p_recorded_at),
      nullif(v_item ->> 'dueAt', '')::timestamptz,
      v_metadata,
      coalesce(v_item ->> 'sourceExcerpt', v_item ->> 'originalText', ''),
      nullif(btrim(coalesce(v_item ->> 'scheduleTitle', '')), ''),
      nullif(v_item ->> 'scheduleStartsAt', '')::timestamptz
    ) r;

    if v_user_result is distinct from v_user_id
       or v_workspace_result is distinct from v_workspace_id
       or v_work_record_id is null
       or v_source_ref_id is null then
      raise exception 'MULTI_ACTION_CHILD_SAVE_INVALID';
    end if;

    update worklog.source_refs sr
    set source_type = v_source_type,
        source_id = v_parent_request_id,
        source_excerpt = coalesce(v_item ->> 'sourceExcerpt', v_item ->> 'originalText', ''),
        metadata = coalesce(sr.metadata, '{}'::jsonb)
          || jsonb_build_object(
            'inputCapture',
            jsonb_build_object(
              'captureId', v_capture_id,
              'requestId', v_parent_request_id,
              'segmentIndex', v_index,
              'segmentCount', v_count,
              'sourceType', v_source_type
            )
          )
    where sr.id = v_source_ref_id
      and sr.workspace_id = v_workspace_id
      and sr.created_by_user_id = v_user_id;

    if not found then
      raise exception 'MULTI_ACTION_SOURCE_REF_LINK_FAILED';
    end if;

    v_work_ids := array_append(v_work_ids, v_work_record_id);
    v_source_ids := array_append(v_source_ids, v_source_ref_id);
    if v_schedule_id is not null then
      v_schedule_ids := array_append(v_schedule_ids, v_schedule_id);
    end if;
  end loop;

  return query
  select v_capture_id, v_count, v_work_ids, v_source_ids, v_schedule_ids;
end;
$function$
;
CREATE OR REPLACE FUNCTION worklog.save_my_multi_action_worklog_v2(p_parent_request_id text, p_original_text text, p_source_type text DEFAULT 'direct'::text, p_recorded_at timestamp with time zone DEFAULT now(), p_capture_metadata jsonb DEFAULT '{}'::jsonb, p_items jsonb DEFAULT '[]'::jsonb)
 RETURNS TABLE(capture_id uuid, saved_count integer, work_record_ids uuid[], source_ref_ids uuid[], schedule_ids uuid[], schedule_snapshots jsonb)
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select saved.capture_id, saved.saved_count, saved.work_record_ids, saved.source_ref_ids, saved.schedule_ids,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', schedule.id,
        'title', schedule.title,
        'startsAt', schedule.starts_at,
        'status', schedule.status,
        'allDay', schedule.all_day
      ) order by array_position(saved.schedule_ids, schedule.id))
      from worklog.schedules schedule
      where schedule.id = any(saved.schedule_ids)
        and schedule.created_by_user_id = (select auth.uid())
    ), '[]'::jsonb)
  from worklog.save_my_multi_action_worklog(
    p_parent_request_id, p_original_text, p_source_type, p_recorded_at, p_capture_metadata, p_items
  ) saved;
$function$
;
CREATE OR REPLACE FUNCTION worklog.save_my_worklog(p_client_request_id text, p_title text, p_content text, p_original_text text, p_record_type text, p_status text, p_institution text DEFAULT NULL::text, p_amount numeric DEFAULT NULL::numeric, p_follow_up text DEFAULT NULL::text, p_recorded_at timestamp with time zone DEFAULT now(), p_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_metadata jsonb DEFAULT '{}'::jsonb, p_source_excerpt text DEFAULT NULL::text)
 RETURNS TABLE(user_id uuid, workspace_id uuid, work_record_id uuid, source_ref_id uuid)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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

  v_metadata := coalesce(p_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'fieldProvenance',
      coalesce(p_metadata -> 'fieldProvenance', '{}'::jsonb)
        || jsonb_build_object('institution', v_institution_source)
    );

  select w.id
  into v_workspace_id
  from worklog.workspaces w
  where w.owner_user_id = v_user_id
    and w.kind = 'personal'
  order by w.created_at asc
  limit 1;

  if v_workspace_id is null then
    raise exception 'PERSONAL_WORKSPACE_MISSING';
  end if;

  insert into worklog.work_records (
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

  insert into worklog.source_refs (
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
    'direct',
    btrim(p_client_request_id),
    p_source_excerpt,
    jsonb_build_object(
      'source', 'quick_worklog',
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
$function$
;
CREATE OR REPLACE FUNCTION worklog.save_my_worklog_with_schedule(p_client_request_id text, p_title text, p_content text, p_original_text text, p_record_type text, p_status text, p_institution text DEFAULT NULL::text, p_amount numeric DEFAULT NULL::numeric, p_follow_up text DEFAULT NULL::text, p_recorded_at timestamp with time zone DEFAULT now(), p_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_metadata jsonb DEFAULT '{}'::jsonb, p_source_excerpt text DEFAULT NULL::text, p_schedule_title text DEFAULT NULL::text, p_schedule_starts_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(user_id uuid, workspace_id uuid, work_record_id uuid, source_ref_id uuid, schedule_id uuid)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_request_id text := btrim(coalesce(p_client_request_id, ''));
  v_user_id uuid;
  v_workspace_id uuid;
  v_work_record_id uuid;
  v_source_ref_id uuid;
  v_schedule_id uuid;
  v_action_kind text;
  v_journal_date_text text;
  v_journal_date date;
begin
  if char_length(v_request_id) < 16 or char_length(v_request_id) > 100 then
    raise exception 'CLIENT_REQUEST_ID_INVALID';
  end if;

  select r.user_id, r.workspace_id, r.work_record_id, r.source_ref_id
  into v_user_id, v_workspace_id, v_work_record_id, v_source_ref_id
  from worklog.save_my_worklog(
    v_request_id, p_title, p_content, p_original_text, p_record_type, p_status,
    p_institution, p_amount, p_follow_up, p_recorded_at, p_due_at, p_metadata, p_source_excerpt
  ) r;

  if v_user_id is null or v_workspace_id is null or v_work_record_id is null or v_source_ref_id is null then
    raise exception 'WORKLOG_SAVE_RESULT_INVALID';
  end if;

  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb) -> 'actionEngine') = 'object' then
    v_action_kind := nullif(btrim(coalesce(p_metadata #>> '{actionEngine,actionKind}', '')), '');
    if v_action_kind is not null and v_action_kind not in ('task', 'note') then
      raise exception 'ACTION_KIND_INVALID';
    end if;

    v_journal_date_text := nullif(btrim(coalesce(p_metadata #>> '{actionEngine,journalDate}', '')), '');
    if v_journal_date_text is not null then
      if v_journal_date_text !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'JOURNAL_DATE_INVALID';
      end if;
      begin
        v_journal_date := v_journal_date_text::date;
      exception when others then
        raise exception 'JOURNAL_DATE_INVALID';
      end;
    end if;

    update worklog.work_records wr
    set action_kind = v_action_kind,
        journal_date = coalesce(v_journal_date, wr.journal_date)
    where wr.id = v_work_record_id
      and wr.workspace_id = v_workspace_id
      and wr.created_by_user_id = v_user_id;

    if not found then
      raise exception 'WORKLOG_ACTION_PROJECTION_FAILED';
    end if;
  end if;

  if p_schedule_starts_at is not null then
    if p_schedule_title is null or char_length(btrim(p_schedule_title)) < 1 or char_length(btrim(p_schedule_title)) > 200 then
      raise exception 'SCHEDULE_TITLE_INVALID';
    end if;

    select s.id into v_schedule_id
    from worklog.schedules s
    where s.workspace_id = v_workspace_id
      and s.created_by_user_id = v_user_id
      and s.metadata ->> 'source' = 'quick_worklog'
      and s.metadata ->> 'sourceRequestId' = v_request_id
    order by s.created_at asc limit 1;

    if v_schedule_id is null then
      insert into worklog.schedules (
        workspace_id, created_by_user_id, title, description, starts_at, all_day, timezone, status, metadata
      ) values (
        v_workspace_id, v_user_id, btrim(p_schedule_title), coalesce(p_original_text, ''), p_schedule_starts_at,
        false, 'Asia/Seoul', 'confirmed',
        jsonb_build_object('source', 'quick_worklog', 'sourceRequestId', v_request_id,
          'workRecordId', v_work_record_id, 'sourceRefId', v_source_ref_id)
      ) returning id into v_schedule_id;
    else
      update worklog.schedules s
      set title = btrim(p_schedule_title), description = coalesce(p_original_text, ''), starts_at = p_schedule_starts_at,
          all_day = false, timezone = 'Asia/Seoul',
          status = case when s.status = 'cancelled' then s.status else 'confirmed' end,
          metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object(
            'source', 'quick_worklog', 'sourceRequestId', v_request_id,
            'workRecordId', v_work_record_id, 'sourceRefId', v_source_ref_id)
      where s.id = v_schedule_id
        and s.workspace_id = v_workspace_id
        and s.created_by_user_id = v_user_id;
    end if;
  end if;

  return query select v_user_id, v_workspace_id, v_work_record_id, v_source_ref_id, v_schedule_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION worklog.save_my_worklog_with_schedule_v2(p_client_request_id text, p_title text, p_content text, p_original_text text, p_record_type text, p_status text, p_institution text DEFAULT NULL::text, p_amount numeric DEFAULT NULL::numeric, p_follow_up text DEFAULT NULL::text, p_recorded_at timestamp with time zone DEFAULT now(), p_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_metadata jsonb DEFAULT '{}'::jsonb, p_source_excerpt text DEFAULT NULL::text, p_schedule_title text DEFAULT NULL::text, p_schedule_starts_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(user_id uuid, workspace_id uuid, work_record_id uuid, source_ref_id uuid, schedule_id uuid, title text, starts_at timestamp with time zone, status text, all_day boolean)
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select saved.user_id, saved.workspace_id, saved.work_record_id, saved.source_ref_id, saved.schedule_id,
    schedule.title, schedule.starts_at, schedule.status, schedule.all_day
  from worklog.save_my_worklog_with_schedule(
    p_client_request_id, p_title, p_content, p_original_text, p_record_type, p_status,
    p_institution, p_amount, p_follow_up, p_recorded_at, p_due_at, p_metadata,
    p_source_excerpt, p_schedule_title, p_schedule_starts_at
  ) saved
  left join worklog.schedules schedule
    on schedule.id = saved.schedule_id
    and schedule.workspace_id = saved.workspace_id
    and schedule.created_by_user_id = saved.user_id;
$function$
;
CREATE OR REPLACE FUNCTION worklog.search_my_work_records(p_query text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS TABLE(work_record_id uuid, workspace_id uuid, workspace_name text, title text, snippet text, institution text, record_type text, status text, recorded_at timestamp with time zone, due_at timestamp with time zone, match_type text, match_rank integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with input as (
    select nullif(btrim(p_query), '') as raw_q
  ),
  params as (
    select
      case when raw_q is not null and char_length(raw_q) <= 120 then raw_q end as q,
      case when raw_q is not null and char_length(raw_q) <= 120 then lower(raw_q) end as q_lower,
      case when raw_q is not null and char_length(raw_q) <= 120 then
        '%' || replace(
          replace(
            replace(raw_q, chr(92), chr(92) || chr(92)),
            '%', chr(92) || '%'
          ),
          '_', chr(92) || '_'
        ) || '%'
      end as pattern,
      greatest(1, least(coalesce(p_limit, 20), 50)) as page_limit,
      greatest(0, least(coalesce(p_offset, 0), 5000)) as page_offset
    from input
  ),
  searchable as (
    select
      wr.id as work_record_id,
      wr.workspace_id,
      w.name as workspace_name,
      wr.title,
      wr.content,
      wr.original_text,
      wr.follow_up,
      wr.record_type,
      wr.status,
      wr.recorded_at,
      wr.due_at,
      n.normalized_title,
      n.normalized_text,
      case when lower(coalesce(
        wr.metadata #>> '{fieldProvenance,institution}',
        wr.metadata #>> '{field_provenance,institution}',
        wr.metadata ->> 'institutionSource',
        wr.metadata ->> 'institution_source',
        n.structured_data #>> '{provenance,institution}',
        ''
      )) in ('user_selected', 'user_confirmed')
        then coalesce(wr.institution, n.structured_data ->> 'institution', '')
        else ''
      end as trusted_institution,
      concat_ws(' ',
        case when lower(coalesce(
          wr.metadata #>> '{fieldProvenance,project}',
          n.structured_data #>> '{provenance,project}',
          ''
        )) in ('user_selected', 'user_confirmed')
          then coalesce(n.structured_data ->> 'project', n.structured_data ->> 'project_name', '')
          else ''
        end,
        case when lower(coalesce(
          wr.metadata #>> '{fieldProvenance,person}',
          n.structured_data #>> '{provenance,person}',
          ''
        )) in ('user_selected', 'user_confirmed')
          then concat_ws(' ', n.structured_data ->> 'person', n.structured_data ->> 'people')
          else ''
        end,
        case when lower(coalesce(
          wr.metadata #>> '{fieldProvenance,contact}',
          n.structured_data #>> '{provenance,contact}',
          ''
        )) in ('user_selected', 'user_confirmed')
          then coalesce(n.structured_data ->> 'contact', '')
          else ''
        end,
        case when lower(coalesce(
          wr.metadata #>> '{fieldProvenance,keywords}',
          n.structured_data #>> '{provenance,keywords}',
          ''
        )) in ('user_selected', 'user_confirmed')
          then coalesce(n.structured_data ->> 'keywords', '')
          else ''
        end
      ) as trusted_structured_text,
      case when lower(coalesce(
        wr.metadata #>> '{fieldProvenance,searchAliases}',
        n.structured_data #>> '{provenance,searchAliases}',
        ''
      )) in ('user_selected', 'user_confirmed')
        then coalesce(n.search_aliases, '{}'::text[])
        else '{}'::text[]
      end as trusted_aliases,
      p.q,
      p.q_lower,
      p.pattern
    from worklog.work_records wr
    join worklog.workspaces w on w.id = wr.workspace_id
    left join worklog.work_record_normalizations n
      on n.work_record_id = wr.id
      and n.workspace_id = wr.workspace_id
    cross join params p
    where p.q is not null
  ),
  candidates as (
    select
      s.*,
      case
        when
          lower(btrim(coalesce(s.title, ''))) = s.q_lower
          or lower(btrim(coalesce(s.content, ''))) = s.q_lower
          or lower(btrim(coalesce(s.trusted_institution, ''))) = s.q_lower
          or lower(btrim(coalesce(s.normalized_title, ''))) = s.q_lower
          or lower(btrim(coalesce(s.normalized_text, ''))) = s.q_lower
          then 0
        when
          (
            coalesce(s.title, '') || ' ' ||
            coalesce(s.content, '') || ' ' ||
            coalesce(s.trusted_institution, '') || ' ' ||
            coalesce(s.follow_up, '')
          ) ilike s.pattern
          or (
            coalesce(s.normalized_title, '') || ' ' ||
            coalesce(s.normalized_text, '') || ' ' ||
            coalesce(s.trusted_structured_text, '')
          ) ilike s.pattern
          then 1
        when
          s.trusted_aliases @> array[s.q]::text[]
          or exists (
            select 1
            from unnest(s.trusted_aliases) as alias_value(value)
            where lower(btrim(alias_value.value)) = s.q_lower
          )
          then 2
        when coalesce(s.original_text, '') ilike s.pattern then 3
        else 9
      end as match_rank
    from searchable s
    where
      lower(btrim(coalesce(s.title, ''))) = s.q_lower
      or lower(btrim(coalesce(s.content, ''))) = s.q_lower
      or lower(btrim(coalesce(s.trusted_institution, ''))) = s.q_lower
      or lower(btrim(coalesce(s.normalized_title, ''))) = s.q_lower
      or lower(btrim(coalesce(s.normalized_text, ''))) = s.q_lower
      or (
        coalesce(s.title, '') || ' ' ||
        coalesce(s.content, '') || ' ' ||
        coalesce(s.original_text, '') || ' ' ||
        coalesce(s.trusted_institution, '') || ' ' ||
        coalesce(s.follow_up, '')
      ) ilike s.pattern
      or (
        coalesce(s.normalized_title, '') || ' ' ||
        coalesce(s.normalized_text, '') || ' ' ||
        coalesce(s.trusted_structured_text, '')
      ) ilike s.pattern
      or s.trusted_aliases @> array[s.q]::text[]
      or exists (
        select 1
        from unnest(s.trusted_aliases) as alias_value(value)
        where lower(btrim(alias_value.value)) = s.q_lower
      )
  ),
  ranked as (
    select
      c.*,
      row_number() over (
        partition by
          c.workspace_id,
          case
            when nullif(c.original_text, '') is not null then 'raw:' || c.original_text
            else 'id:' || c.work_record_id::text
          end
        order by c.match_rank asc, c.recorded_at desc, c.work_record_id
      ) as source_group_row
    from candidates c
    where c.match_rank < 9
  )
  select
    r.work_record_id,
    r.workspace_id,
    r.workspace_name,
    r.title,
    case
      when r.match_rank = 3 then
        substring(
          r.original_text
          from greatest(1, strpos(lower(r.original_text), r.q_lower) - 80)
          for 280
        )
      else left(
        coalesce(
          nullif(r.content, ''),
          nullif(r.normalized_text, ''),
          nullif(r.original_text, ''),
          r.title
        ),
        280
      )
    end as snippet,
    nullif(r.trusted_institution, '') as institution,
    r.record_type,
    r.status,
    r.recorded_at,
    r.due_at,
    case r.match_rank
      when 0 then 'exact'
      when 1 then 'partial'
      when 2 then 'alias'
      when 3 then 'partial'
      else 'unknown'
    end as match_type,
    r.match_rank
  from ranked r
  cross join params p
  where r.match_rank < 3
     or (r.match_rank = 3 and r.source_group_row = 1)
  order by r.match_rank asc, r.recorded_at desc, r.work_record_id
  limit (select page_limit from params)
  offset (select page_offset from params);
$function$
;
CREATE OR REPLACE FUNCTION worklog.set_my_work_record_attention(p_record_id uuid, p_next_attention_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(record_id uuid, next_attention_at_value timestamp with time zone, previous_attention_at_value timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
  v_previous_attention_at timestamptz;
  v_record_id uuid;
  v_next_attention_at timestamptz;
begin
  if v_user_id is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if p_next_attention_at is not null and p_next_attention_at <= now() then raise exception 'WORK_RECORD_ATTENTION_MUST_BE_FUTURE'; end if;
  select w.id into v_workspace_id
  from worklog.workspaces w
  where w.owner_user_id = v_user_id and w.kind = 'personal'
  order by w.created_at asc limit 1;
  if v_workspace_id is null then raise exception 'PERSONAL_WORKSPACE_MISSING'; end if;

  select wr.next_attention_at into v_previous_attention_at
  from worklog.work_records wr
  where wr.id = p_record_id
    and wr.workspace_id = v_workspace_id
    and wr.created_by_user_id = v_user_id
    and wr.status in ('in_progress', 'waiting', 'needs_review')
    and wr.action_kind is distinct from 'note';
  if not found then raise exception 'WORK_RECORD_NOT_FOUND_OR_FORBIDDEN'; end if;

  update worklog.work_records wr
  set next_attention_at = p_next_attention_at,
      updated_at = now()
  where wr.id = p_record_id
    and wr.workspace_id = v_workspace_id
    and wr.created_by_user_id = v_user_id
  returning wr.id, wr.next_attention_at into v_record_id, v_next_attention_at;

  return query select v_record_id, v_next_attention_at, v_previous_attention_at;
end;
$function$
;
CREATE OR REPLACE FUNCTION worklog.undo_my_work_record_attention(p_record_id uuid, p_expected_attention_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_previous_attention_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(record_id uuid, next_attention_at_value timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
  v_current_attention_at timestamptz;
  v_record_id uuid;
  v_next_attention_at timestamptz;
begin
  if v_user_id is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;

  select w.id into v_workspace_id
  from worklog.workspaces w
  where w.owner_user_id = v_user_id and w.kind = 'personal'
  order by w.created_at asc limit 1;
  if v_workspace_id is null then raise exception 'PERSONAL_WORKSPACE_MISSING'; end if;

  select wr.next_attention_at
  into v_current_attention_at
  from worklog.work_records wr
  where wr.id = p_record_id
    and wr.workspace_id = v_workspace_id
    and wr.created_by_user_id = v_user_id
    and wr.status in ('in_progress', 'waiting', 'needs_review')
    and wr.action_kind is distinct from 'note';
  if not found then raise exception 'WORK_RECORD_NOT_FOUND_OR_FORBIDDEN'; end if;

  if v_current_attention_at is distinct from p_expected_attention_at then
    raise exception 'WORK_RECORD_ATTENTION_UNDO_STALE';
  end if;

  update worklog.work_records wr
  set next_attention_at = p_previous_attention_at,
      updated_at = now()
  where wr.id = p_record_id
    and wr.workspace_id = v_workspace_id
    and wr.created_by_user_id = v_user_id
  returning wr.id, wr.next_attention_at into v_record_id, v_next_attention_at;

  return query select v_record_id, v_next_attention_at;
end;
$function$
;
CREATE OR REPLACE FUNCTION worklog.undo_my_work_record_postpone(p_record_id uuid)
 RETURNS TABLE(record_id uuid, due_at_value timestamp with time zone, due_has_time boolean)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  from worklog.workspaces w
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
  from worklog.work_records wr
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

  update worklog.work_records wr
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
$function$
;
CREATE OR REPLACE FUNCTION worklog.update_my_note_briefing_state(p_record_id uuid, p_state text)
 RETURNS TABLE(record_id uuid, briefing_state_value text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  if p_state not in ('active', 'acknowledged') then
    raise exception 'BRIEFING_STATE_INVALID';
  end if;

  select w.id
  into v_workspace_id
  from worklog.workspaces w
  where w.owner_user_id = v_user_id
    and w.kind = 'personal'
  order by w.created_at asc
  limit 1;

  if v_workspace_id is null then
    raise exception 'PERSONAL_WORKSPACE_MISSING';
  end if;

  return query
  update worklog.work_records wr
  set briefing_state = p_state
  where wr.id = p_record_id
    and wr.workspace_id = v_workspace_id
    and wr.created_by_user_id = v_user_id
    and wr.action_kind = 'note'
  returning wr.id, wr.briefing_state;
end;
$function$
;
CREATE OR REPLACE FUNCTION worklog.update_my_work_record_details(p_record_id uuid, p_title text, p_due_at timestamp with time zone, p_due_has_time boolean DEFAULT false)
 RETURNS TABLE(record_id uuid, title_value text, due_at_value timestamp with time zone, due_has_time boolean, schedule_updated boolean)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
  v_title text := btrim(coalesce(p_title, ''));
  v_due_has_time boolean := case when p_due_at is null then false else coalesce(p_due_has_time, false) end;
  v_record_id uuid;
  v_title_value text;
  v_due_at_value timestamptz;
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

  select w.id
  into v_workspace_id
  from worklog.workspaces w
  where w.owner_user_id = v_user_id
    and w.kind = 'personal'
  order by w.created_at asc
  limit 1;

  if v_workspace_id is null then
    raise exception 'PERSONAL_WORKSPACE_MISSING';
  end if;

  update worklog.work_records wr
  set title = v_title,
      due_at = p_due_at,
      metadata = coalesce(wr.metadata, '{}'::jsonb) || jsonb_build_object('dueTimeExplicit', v_due_has_time),
      updated_at = now()
  where wr.id = p_record_id
    and wr.workspace_id = v_workspace_id
    and wr.created_by_user_id = v_user_id
  returning wr.id, wr.title, wr.due_at
  into v_record_id, v_title_value, v_due_at_value;

  if v_record_id is null then
    raise exception 'WORK_RECORD_NOT_FOUND_OR_FORBIDDEN';
  end if;

  update worklog.schedules s
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
  select v_record_id, v_title_value, v_due_at_value, v_due_has_time, (v_schedule_count > 0);
end;
$function$
;
CREATE OR REPLACE FUNCTION worklog.update_my_work_record_details_v2(p_record_id uuid, p_title text, p_due_at timestamp with time zone, p_due_has_time boolean DEFAULT false, p_action_kind text DEFAULT NULL::text)
 RETURNS TABLE(record_id uuid, title_value text, due_at_value timestamp with time zone, due_has_time boolean, action_kind_value text, action_kind_changed boolean, schedule_updated boolean)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  from worklog.workspaces w
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
      from worklog.schedules s
      where s.workspace_id = v_workspace_id
        and s.created_by_user_id = v_user_id
        and s.metadata ->> 'workRecordId' = wr.id::text
    )
  into v_previous_action_kind, v_has_linked_schedule
  from worklog.work_records wr
  where wr.id = p_record_id
    and wr.workspace_id = v_workspace_id
    and wr.created_by_user_id = v_user_id;

  if not found then
    raise exception 'WORK_RECORD_NOT_FOUND_OR_FORBIDDEN';
  end if;

  if v_action_kind is not null
     and v_action_kind is distinct from v_previous_action_kind
     and v_previous_action_kind not in ('task', 'note') then
    raise exception 'WORK_RECORD_ACTION_CONVERSION_UNCLASSIFIED';
  end if;

  if v_action_kind is not null
     and v_action_kind is distinct from v_previous_action_kind
     and v_has_linked_schedule then
    raise exception 'WORK_RECORD_ACTION_CONVERSION_SCHEDULE_LINKED';
  end if;

  update worklog.work_records wr
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
          when v_action_kind in ('task', 'note') and v_action_kind is distinct from wr.action_kind then jsonb_build_object(
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
  update worklog.schedules s
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
$function$
;
CREATE OR REPLACE FUNCTION worklog.update_my_work_record_details_v3(p_record_id uuid, p_title text, p_due_at timestamp with time zone, p_due_has_time boolean DEFAULT false, p_action_kind text DEFAULT NULL::text)
 RETURNS TABLE(record_id uuid, title_value text, due_at_value timestamp with time zone, due_has_time boolean, action_kind_value text, action_kind_changed boolean, schedule_updated boolean, schedule_id uuid, schedule_title text, schedule_starts_at timestamp with time zone, schedule_status text, schedule_all_day boolean)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  return query
  select
    details.record_id,
    details.title_value,
    details.due_at_value,
    details.due_has_time,
    details.action_kind_value,
    details.action_kind_changed,
    details.schedule_updated,
    linked.id,
    linked.title,
    linked.starts_at,
    linked.status,
    linked.all_day
  from worklog.update_my_work_record_details_v2(
    p_record_id,
    p_title,
    p_due_at,
    p_due_has_time,
    p_action_kind
  ) details
  left join lateral (
    select s.id, s.title, s.starts_at, s.status, s.all_day
    from worklog.schedules s
    where s.metadata ->> 'workRecordId' = p_record_id::text
      and s.created_by_user_id = (select auth.uid())
      and s.workspace_id in (
        select w.id from worklog.workspaces w
        where w.owner_user_id = (select auth.uid()) and w.kind = 'personal'
      )
    order by s.updated_at desc, s.id asc
    limit 1
  ) linked on true;
end;
$function$
;
CREATE OR REPLACE FUNCTION worklog.update_my_work_record_status(p_record_id uuid, p_status text)
 RETURNS TABLE(record_id uuid, status_value text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  if p_status not in ('in_progress', 'completed', 'waiting', 'needs_review') then
    raise exception 'WORK_RECORD_STATUS_INVALID';
  end if;

  select w.id
  into v_workspace_id
  from worklog.workspaces w
  where w.owner_user_id = v_user_id
    and w.kind = 'personal'
  order by w.created_at asc
  limit 1;

  if v_workspace_id is null then
    raise exception 'PERSONAL_WORKSPACE_MISSING';
  end if;

  return query
  update worklog.work_records wr
  set status = p_status
  where wr.id = p_record_id
    and wr.workspace_id = v_workspace_id
    and wr.created_by_user_id = v_user_id
  returning wr.id, wr.status;
end;
$function$
;
revoke all on all functions in schema worklog from public,anon,authenticated;
revoke all on all functions in schema worklog_private from public,anon,authenticated;
grant usage on schema worklog,worklog_private to authenticated,service_role;
grant execute on function worklog_private.can_access_workspace(uuid),worklog_private.is_workspace_owner(uuid),worklog_private.ensure_current_user_personal_workspace() to authenticated;
grant select on all tables in schema worklog to authenticated;
grant insert,update on worklog.work_records,worklog.schedules,worklog.input_captures,worklog.work_record_normalizations to authenticated;
grant insert,update,delete on worklog.source_refs,worklog.candidates,worklog.notification_preferences,worklog.push_subscriptions to authenticated;
-- No workspace/member provisioning grants; the importer/admin owns admission.
grant select,insert,update,delete on all tables in schema worklog to service_role;
grant execute on all functions in schema worklog,worklog_private to service_role;
grant execute on function worklog.bootstrap_personal_workspace() to authenticated;
grant execute on function worklog.cancel_my_schedule(p_schedule_id uuid) to authenticated;
grant execute on function worklog.cancel_my_work_record(p_record_id uuid) to authenticated;
grant execute on function worklog.clear_irrelevant_work_record_attention() to authenticated;
grant execute on function worklog.confirm_my_worklog_reminder(p_record_id uuid, p_starts_at timestamp with time zone) to authenticated;
grant execute on function worklog.confirm_schedule_candidate(p_candidate_id uuid) to authenticated;
grant execute on function worklog.get_my_briefing_source() to authenticated;
grant execute on function worklog.get_my_work_journal_day(p_date date) to authenticated;
grant execute on function worklog.get_my_work_record_edit(p_record_id uuid) to authenticated;
grant execute on function worklog.get_my_work_record_edit_v2(p_record_id uuid) to authenticated;
grant execute on function worklog.postpone_my_work_record(p_record_id uuid, p_due_at timestamp with time zone, p_due_has_time boolean) to authenticated;
grant execute on function worklog.save_my_multi_action_worklog(p_parent_request_id text, p_original_text text, p_source_type text, p_recorded_at timestamp with time zone, p_capture_metadata jsonb, p_items jsonb) to authenticated;
grant execute on function worklog.save_my_multi_action_worklog_v2(p_parent_request_id text, p_original_text text, p_source_type text, p_recorded_at timestamp with time zone, p_capture_metadata jsonb, p_items jsonb) to authenticated;
grant execute on function worklog.save_my_worklog(p_client_request_id text, p_title text, p_content text, p_original_text text, p_record_type text, p_status text, p_institution text, p_amount numeric, p_follow_up text, p_recorded_at timestamp with time zone, p_due_at timestamp with time zone, p_metadata jsonb, p_source_excerpt text) to authenticated;
grant execute on function worklog.save_my_worklog_with_schedule(p_client_request_id text, p_title text, p_content text, p_original_text text, p_record_type text, p_status text, p_institution text, p_amount numeric, p_follow_up text, p_recorded_at timestamp with time zone, p_due_at timestamp with time zone, p_metadata jsonb, p_source_excerpt text, p_schedule_title text, p_schedule_starts_at timestamp with time zone) to authenticated;
grant execute on function worklog.save_my_worklog_with_schedule_v2(p_client_request_id text, p_title text, p_content text, p_original_text text, p_record_type text, p_status text, p_institution text, p_amount numeric, p_follow_up text, p_recorded_at timestamp with time zone, p_due_at timestamp with time zone, p_metadata jsonb, p_source_excerpt text, p_schedule_title text, p_schedule_starts_at timestamp with time zone) to authenticated;
grant execute on function worklog.search_my_work_records(p_query text, p_limit integer, p_offset integer) to authenticated;
grant execute on function worklog.set_my_work_record_attention(p_record_id uuid, p_next_attention_at timestamp with time zone) to authenticated;
grant execute on function worklog.undo_my_work_record_attention(p_record_id uuid, p_expected_attention_at timestamp with time zone, p_previous_attention_at timestamp with time zone) to authenticated;
grant execute on function worklog.undo_my_work_record_postpone(p_record_id uuid) to authenticated;
grant execute on function worklog.update_my_note_briefing_state(p_record_id uuid, p_state text) to authenticated;
grant execute on function worklog.update_my_work_record_details(p_record_id uuid, p_title text, p_due_at timestamp with time zone, p_due_has_time boolean) to authenticated;
grant execute on function worklog.update_my_work_record_details_v2(p_record_id uuid, p_title text, p_due_at timestamp with time zone, p_due_has_time boolean, p_action_kind text) to authenticated;
grant execute on function worklog.update_my_work_record_details_v3(p_record_id uuid, p_title text, p_due_at timestamp with time zone, p_due_has_time boolean, p_action_kind text) to authenticated;
grant execute on function worklog.update_my_work_record_status(p_record_id uuid, p_status text) to authenticated;

