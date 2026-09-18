-- PR #358: Schedule edits are creator-only and mobile cancellation is a soft
-- state transition. RLS is the enforcement boundary; client filters are not.

drop policy if exists schedules_update_member on public.schedules;
drop policy if exists schedules_update_creator on public.schedules;

create policy schedules_update_creator
on public.schedules
for update
to authenticated
using (
  (select private.can_access_workspace(workspace_id))
  and created_by_user_id = (select auth.uid())
)
with check (
  (select private.can_access_workspace(workspace_id))
  and created_by_user_id = (select auth.uid())
);

-- Schedules and WorkRecords are retained as history. Authenticated callers
-- must use their soft-state transitions instead of hard DELETE.
drop policy if exists schedules_delete_member on public.schedules;
drop policy if exists schedules_delete_creator on public.schedules;
drop policy if exists work_records_delete_member on public.work_records;
drop policy if exists work_records_delete_creator on public.work_records;

revoke delete on table public.schedules from authenticated;
revoke delete on table public.work_records from authenticated;
