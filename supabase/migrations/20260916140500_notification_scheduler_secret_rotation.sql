-- Rotate the notification scheduler shared secret without storing its plaintext.

create or replace function public._notification_scheduler_secret_ok(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex')
    = '3701cc640c19e82bba8683caaab3e01cdfd11677941dbb1fa8f89e0f18c19000';
$$;

revoke all on function public._notification_scheduler_secret_ok(text) from public, anon, authenticated;
