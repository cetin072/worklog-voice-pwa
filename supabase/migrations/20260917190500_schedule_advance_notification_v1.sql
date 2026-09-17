-- Issue #327: claim due schedule reminders for existing Web Push subscriptions.
-- Production application requires explicit approval.

alter table public.notification_deliveries drop constraint if exists notification_deliveries_kind_check;
alter table public.notification_deliveries add constraint notification_deliveries_kind_check check (kind in ('morning_digest','afternoon_incomplete','schedule_advance'));
create unique index if not exists notification_schedule_advance_unique on public.notification_deliveries(subscription_id,kind,source_key) where kind='schedule_advance';

create or replace function public.claim_schedule_advance_notification_deliveries(p_scheduler_secret text,p_app_origin text,p_now timestamptz default now())
returns table(delivery_id uuid,subscription_id uuid,endpoint text,p256dh text,auth_secret text,schedule_id uuid,schedule_title text,schedule_starts_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  if p_scheduler_secret is distinct from current_setting('app.settings.notification_scheduler_secret',true) then raise exception 'NOTIFICATION_SCHEDULER_FORBIDDEN' using errcode='42501'; end if;
  return query
  with due as (
    select s.id,s.created_by_user_id,s.title,s.starts_at
    from public.schedules s
    where s.all_day=false and s.status in ('confirmed','tentative')
      and coalesce(s.reminder_at,s.starts_at-interval '30 minutes') <= p_now
      and coalesce(s.reminder_at,s.starts_at-interval '30 minutes') > p_now-interval '5 minutes'
      and s.starts_at > p_now
  ), subs as (
    select ps.id,ps.user_id,ps.endpoint,ps.p256dh,ps.auth_secret
    from public.push_subscriptions ps where ps.app_origin=p_app_origin and ps.disabled_at is null
  ), ins as (
    insert into public.notification_deliveries(subscription_id,kind,local_date,source_key,status,metadata)
    select subs.id,'schedule_advance',(p_now at time zone 'Asia/Seoul')::date,due.id::text,'claimed',jsonb_build_object('scheduleId',due.id)
    from due join subs on subs.user_id=due.created_by_user_id
    on conflict do nothing returning id,subscription_id,source_key
  )
  select ins.id,subs.id,subs.endpoint,subs.p256dh,subs.auth_secret,due.id,due.title,due.starts_at
  from ins join subs on subs.id=ins.subscription_id join due on due.id::text=ins.source_key;
end; $$;
revoke all on function public.claim_schedule_advance_notification_deliveries(text,text,timestamptz) from public,authenticated;
grant execute on function public.claim_schedule_advance_notification_deliveries(text,text,timestamptz) to anon;
