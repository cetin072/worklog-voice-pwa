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
    = 'e3c3571afbb86297f6985f1e9771713d89a650b12f9e8bfb58b5a498a7da7bbe';
$$;

revoke all on function public._notification_scheduler_secret_ok(text)
  from public, anon, authenticated, service_role;
