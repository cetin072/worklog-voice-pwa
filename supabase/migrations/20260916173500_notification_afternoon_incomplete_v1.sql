-- Afternoon incomplete Push v1: opt-in 16:30 reminder using existing delivery infrastructure.

alter table public.notification_preferences
  add column if not exists afternoon_enabled boolean not null default false,
  add column if not exists afternoon_time time without time zone not null default time '16:30';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'notification_preferences_afternoon_time_check'
  ) then
    alter table public.notification_preferences
      add constraint notification_preferences_afternoon_time_check
      check (afternoon_time = time '16:30');
  end if;
end $$;

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_kind_check;

alter table public.notification_deliveries
  add constraint notification_deliveries_kind_check
  check (kind in ('morning_digest','afternoon_incomplete'));

create or replace function public.claim_afternoon_notification_deliveries(
  p_scheduler_secret text,
  p_app_origin text,
  p_local_date date default null
)
returns table (
  delivery_id uuid,
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth_secret text,
  today_count integer,
  overdue_count integer,
  schedule_count integer,
  morning_detail_enabled boolean,
  primary_work_title text,
  primary_work_bucket text,
  primary_schedule_title text,
  primary_schedule_time text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_local_date date := coalesce(p_local_date, (now() at time zone 'Asia/Seoul')::date);
begin
  if not public._notification_scheduler_secret_ok(p_scheduler_secret) then
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
    from public.notification_preferences np
    join public.push_subscriptions ps
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
      from public.work_records wr
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
      from public.work_records wr
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
    insert into public.notification_deliveries as nd (
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
$$;

revoke all on function public.claim_afternoon_notification_deliveries(text, text, date) from public, authenticated;
grant execute on function public.claim_afternoon_notification_deliveries(text, text, date) to anon;
