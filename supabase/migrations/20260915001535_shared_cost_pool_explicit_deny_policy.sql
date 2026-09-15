-- Shared cost pools are trusted-server/admin only.
-- Keep an explicit authenticated deny policy so the RLS intent is visible to advisors/reviewers.

create policy shared_cost_pools_deny_authenticated_select
on public.shared_cost_pools
for select
to authenticated
using (false);
