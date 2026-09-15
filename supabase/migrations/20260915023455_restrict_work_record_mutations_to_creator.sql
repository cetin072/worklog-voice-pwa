-- Major Gate hardening: a workspace member may change only the WorkRecord
-- they created. The briefing mutation adapter carries the same predicate,
-- while this RLS policy remains the authoritative enforcement boundary.

drop policy if exists work_records_update_member on public.work_records;
drop policy if exists work_records_update_creator on public.work_records;

create policy work_records_update_creator
on public.work_records
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
