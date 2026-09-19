-- Issue #385 / Stage 4-0: rotate the notification scheduler shared secret.
-- Only the SHA-256 digest is stored in Git. The plaintext secret lives only in the server environment.

create or replace function public._notification_scheduler_secret_ok(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex')
    = 'cee2e82978fa1f3c8377a8784ad1eb3c6f6367139991976f5d1d32c254b62da9';
$$;

revoke all on function public._notification_scheduler_secret_ok(text)
  from public, anon, authenticated, service_role;
