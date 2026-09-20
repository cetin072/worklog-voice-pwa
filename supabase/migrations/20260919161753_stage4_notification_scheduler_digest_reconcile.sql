-- Issue #385 / Stage 4-0: reconcile the Production scheduler secret digest.
-- The original rotation history entry was present but its deployed function did
-- not match the Netlify Production secret. Only a SHA-256 digest is stored here.

create or replace function public._notification_scheduler_secret_ok(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex')
    = 'e3c3571afbb86297f6985f1e9771713d89a650b12f9e8bfb58b5a498a7da7bbe';
$$;

revoke all on function public._notification_scheduler_secret_ok(text)
  from public, anon, authenticated, service_role;
