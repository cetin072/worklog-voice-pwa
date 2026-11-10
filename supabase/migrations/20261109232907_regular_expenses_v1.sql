-- LOCAL REVIEW ONLY. Shared QA/production project: do not auto-apply.
alter table worklog.subscriptions
  add column expense_kind text not null default 'subscription' check (expense_kind in ('subscription','insurance','transfer','other')),
  add column variable_amount boolean not null default false;

-- Append-only acknowledgements. The unique occurrence key makes retries idempotent.
create table worklog.subscription_payments (
  subscription_id uuid not null references worklog.subscriptions(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  due_date date not null,
  amount_krw integer not null check (amount_krw > 0 and amount_krw <= 100000000),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  variable_amount boolean not null,
  confirmed_at timestamptz not null default now(),
  primary key (subscription_id, due_date)
);
alter table worklog.subscription_payments enable row level security;
revoke all on worklog.subscription_payments from anon, authenticated;
grant select, insert on worklog.subscription_payments to authenticated;
create policy subscription_payments_select_owner on worklog.subscription_payments for select to authenticated
  using (user_id = (select auth.uid()));
create policy subscription_payments_insert_owner on worklog.subscription_payments for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (
    select 1 from worklog.subscriptions s where s.id = subscription_id and s.user_id = (select auth.uid()) and s.archived_at is null
    and s.name = subscription_payments.name and s.amount_krw = subscription_payments.amount_krw and s.variable_amount = subscription_payments.variable_amount
    and due_date >= s.billing_anchor_date
    and (s.billing_cycle = 'monthly' or extract(month from due_date) = extract(month from s.billing_anchor_date))
    and due_date = (date_trunc('month', due_date)::date + (least(extract(day from s.billing_anchor_date)::int,
      extract(day from (date_trunc('month', due_date) + interval '1 month - 1 day'))::int) - 1))
  ));

create function worklog.confirm_subscription_payment(p_subscription_id uuid, p_due_date date)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare s worklog.subscriptions; result jsonb;
begin
  -- Returning a previous result is allowed even after an item has ended.
  select to_jsonb(p) into result from worklog.subscription_payments p
    where p.subscription_id = p_subscription_id and p.due_date = p_due_date;
  if result is not null then return result; end if;
  select * into s from worklog.subscriptions where id = p_subscription_id and archived_at is null for share;
  if s.id is null then raise exception 'EXPENSE_NOT_AVAILABLE' using errcode = '42501'; end if;
  insert into worklog.subscription_payments(subscription_id,due_date,amount_krw,name,variable_amount)
    values(s.id,p_due_date,s.amount_krw,s.name,s.variable_amount) on conflict do nothing;
  select to_jsonb(p) into result from worklog.subscription_payments p
    where p.subscription_id = p_subscription_id and p.due_date = p_due_date;
  return result;
end $$;
revoke all on function worklog.confirm_subscription_payment(uuid,date) from public, anon;
grant execute on function worklog.confirm_subscription_payment(uuid,date) to authenticated;

-- Support the existing owner-filtered list/week queries.
create index subscription_payments_owner_due on worklog.subscription_payments(user_id,due_date desc);
