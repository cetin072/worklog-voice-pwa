-- Optional payment labels only; existing subscriptions and owner RLS remain unchanged.
alter table worklog.subscriptions
  add column payment_method text,
  add column payment_name text,
  add constraint subscriptions_payment_method_check
    check (payment_method is null or payment_method in ('card', 'bank_transfer', 'other')),
  add constraint subscriptions_payment_name_check
    check (payment_name is null or char_length(btrim(payment_name)) between 1 and 60),
  add constraint subscriptions_payment_name_method_check
    check (payment_name is null or payment_method is not null);
