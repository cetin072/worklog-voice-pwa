alter table public.push_subscriptions
  add column if not exists last_failure_status integer,
  add column if not exists last_failure_code text;

alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_failure_status_range,
  add constraint push_subscriptions_failure_status_range
    check (last_failure_status is null or last_failure_status between 100 and 599),
  drop constraint if exists push_subscriptions_failure_code_length,
  add constraint push_subscriptions_failure_code_length
    check (last_failure_code is null or char_length(last_failure_code) <= 80);
