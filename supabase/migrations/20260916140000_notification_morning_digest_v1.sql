-- Morning Push v1: opt-in preferences, origin-scoped subscriptions, and delivery dedupe.

alter table public.push_subscriptions
  add column if not exists app_origin text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'push_subscriptions_app_origin_https_check'
  ) then
    alter table public.push_subscriptions
      add constraint push_subscriptions_app_origin_https_check
      check (app_origin is null or app_origin ~ '^https://[^/]+$');
  end if;
end $$;

create index if not exists push_subscriptions_active_origin_idx
  on public.push_subscriptions (app_origin, workspace_id, user_id)
  where disabled_at is null;

create table if not exists public.notification_preferences (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  morning_enabled boolean not null default false,
  morning_time time without time zone not null default time '08:30',
  timezone text not null default 'Asia/Seoul',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  constraint notification_preferences_timezone_check check (timezone = 'Asia/Seoul'),
  constraint notification_preferences_morning_time_check check (morning_time = time '08:30')
);

alter table public.notification_preferences enable row level security;

drop policy if exists notification_preferences_select_own on public.notification_preferences;
create policy notification_preferences_select_own
  on public.notification_preferences
  for select
  to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = notification_preferences.workspace_id
        and wm.user_id = auth.uid()
    )
  );

drop policy if exists notification_preferences_insert_own on public.notification_preferences;
create policy notification_preferences_insert_own
  on public.notification_preferences
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = notification_preferences.workspace_id
        and wm.user_id = auth.uid()
    )
  );

drop policy if exists notification_preferences_update_own on public.notification_preferences;
create policy notification_preferences_update_own
  on public.notification_preferences
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = notification_preferences.workspace_id
        and wm.user_id = auth.uid()
    )
  );

revoke all on public.notification_preferences from anon;
revoke delete on public.notification_preferences from authenticated;
grant select, insert, update on public.notification_preferences to authenticated;

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  kind text not null,
  local_date date not null,
  status text not null default 'pending',
  error_status integer,
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint notification_deliveries_kind_check check (kind in ('morning_digest')),
  constraint notification_deliveries_status_check check (status in ('pending','sent','failed')),
  constraint notification_deliveries_error_status_check check (error_status is null or error_status between 100 and 599),
  constraint notification_deliveries_error_code_check check (error_code is null or char_length(error_code) <= 80),
  constraint notification_deliveries_metadata_check check (jsonb_typeof(metadata) = 'object'),
  unique (subscription_id, kind, local_date)
);

alter table public.notification_deliveries enable row level security;

drop policy if exists notification_deliveries_select_own on public.notification_deliveries;
create policy notification_deliveries_select_own
  on public.notification_deliveries
  for select
  to authenticated
  using (user_id = auth.uid());

revoke all on public.notification_deliveries from anon, authenticated;
grant select on public.notification_deliveries to authenticated;

create index if not exists notification_deliveries_user_date_idx
  on public.notification_deliveries (user_id, local_date desc, created_at desc);

create or replace function public._notification_scheduler_secret_ok(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex')
    = 'b2b79a3754aab06b4086d706d5bc1a94559e7de363382038d8dd3c5843b20336';
$$;

revoke all on function public._notification_scheduler_secret_ok(text) from public, anon, authenticated;

create or replace function public.claim_morning_notification_deliveries(
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
  schedule_count integer
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
      coalesce(schedule_counts.schedule_count, 0)::integer as schedule_count
    from public.notification_preferences np
    join public.push_subscriptions ps
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
      from public.work_records wr
      where wr.workspace_id = np.workspace_id
        and wr.status in ('in_progress','waiting','needs_review')
        and coalesce(wr.metadata->>'project', '') not in ('SYSTEM_DAILY_BRIEFING','SYSTEM_SPLIT_SOURCE','SYSTEM_TEST')
    ) work_counts on true
    left join lateral (
      select count(*) as schedule_count
      from public.schedules s
      where s.workspace_id = np.workspace_id
        and s.status in ('confirmed','tentative')
        and s.starts_at >= (v_local_date::timestamp at time zone 'Asia/Seoul')
        and s.starts_at < ((v_local_date + 1)::timestamp at time zone 'Asia/Seoul')
    ) schedule_counts on true
    where np.morning_enabled = true
      and np.morning_time = time '08:30'
      and np.timezone = 'Asia/Seoul'
  ),
  eligible as (
    select * from candidates
    where today_count + overdue_count + schedule_count > 0
  ),
  inserted as (
    insert into public.notification_deliveries (
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
        'scheduleCount', e.schedule_count
      )
    from eligible e
    on conflict (subscription_id, kind, local_date) do nothing
    returning id, subscription_id
  )
  select
    i.id,
    e.subscription_id,
    e.endpoint,
    e.p256dh,
    e.auth_secret,
    e.today_count,
    e.overdue_count,
    e.schedule_count
  from inserted i
  join eligible e on e.subscription_id = i.subscription_id;
end;
$$;

revoke all on function public.claim_morning_notification_deliveries(text, text, date) from public, authenticated;
grant execute on function public.claim_morning_notification_deliveries(text, text, date) to anon;

create or replace function public.finish_notification_delivery(
  p_scheduler_secret text,
  p_delivery_id uuid,
  p_success boolean,
  p_status integer default null,
  p_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_subscription_id uuid;
  v_now timestamptz := now();
begin
  if not public._notification_scheduler_secret_ok(p_scheduler_secret) then
    raise exception 'notification scheduler authentication failed' using errcode = '42501';
  end if;

  update public.notification_deliveries
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
    update public.push_subscriptions
    set last_success_at = v_now,
        last_failure_at = null,
        last_failure_status = null,
        last_failure_code = null,
        updated_at = v_now
    where id = v_subscription_id;
  else
    update public.push_subscriptions
    set last_failure_at = v_now,
        last_failure_status = p_status,
        last_failure_code = left(coalesce(p_code, 'UNKNOWN'), 80),
        disabled_at = case when p_status in (404, 410) then v_now else disabled_at end,
        updated_at = v_now
    where id = v_subscription_id;
  end if;

  return true;
end;
$$;

revoke all on function public.finish_notification_delivery(text, uuid, boolean, integer, text) from public, authenticated;
grant execute on function public.finish_notification_delivery(text, uuid, boolean, integer, text) to anon;
