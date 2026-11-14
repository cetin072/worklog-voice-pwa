-- Existing KRW values stay in won. USD values use integer cents.
alter table worklog.subscriptions
  alter column amount_krw drop not null,
  add column amount_usd_cents integer check (amount_usd_cents between 1 and 100000000),
  add constraint subscriptions_one_currency check (num_nonnulls(amount_krw, amount_usd_cents) = 1);

alter table worklog.subscription_payments
  alter column amount_krw drop not null,
  add column amount_usd_cents integer check (amount_usd_cents between 1 and 100000000),
  add constraint subscription_payments_one_currency check (num_nonnulls(amount_krw, amount_usd_cents) = 1);

alter policy subscription_payments_insert_owner on worklog.subscription_payments
  with check (user_id = (select auth.uid()) and exists (
    select 1 from worklog.subscriptions s where s.id = subscription_id and s.user_id = (select auth.uid()) and s.archived_at is null
    and s.name = subscription_payments.name and s.amount_krw is not distinct from subscription_payments.amount_krw
    and s.amount_usd_cents is not distinct from subscription_payments.amount_usd_cents and s.variable_amount = subscription_payments.variable_amount
    and due_date >= s.billing_anchor_date
    and (s.billing_cycle = 'monthly' or extract(month from due_date) = extract(month from s.billing_anchor_date))
    and due_date = (date_trunc('month', due_date)::date + (least(extract(day from s.billing_anchor_date)::int,
      extract(day from (date_trunc('month', due_date) + interval '1 month - 1 day'))::int) - 1))
  ));

create or replace function worklog.confirm_subscription_payment(p_subscription_id uuid, p_due_date date)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare s worklog.subscriptions; result jsonb;
begin
  -- Returning a previous result is allowed even after an item has ended.
  select to_jsonb(p) into result from worklog.subscription_payments p
    where p.subscription_id = p_subscription_id and p.due_date = p_due_date;
  if result is not null then return result; end if;
  select * into s from worklog.subscriptions where id = p_subscription_id and archived_at is null for share;
  if s.id is null then raise exception 'EXPENSE_NOT_AVAILABLE' using errcode = '42501'; end if;
  insert into worklog.subscription_payments(subscription_id,due_date,amount_krw,amount_usd_cents,name,variable_amount)
    values(s.id,p_due_date,s.amount_krw,s.amount_usd_cents,s.name,s.variable_amount) on conflict do nothing;
  select to_jsonb(p) into result from worklog.subscription_payments p
    where p.subscription_id = p_subscription_id and p.due_date = p_due_date;
  return result;
end $$;
revoke all on function worklog.confirm_subscription_payment(uuid,date) from public, anon;
grant execute on function worklog.confirm_subscription_payment(uuid,date) to authenticated;
