-- Issue #446: an additive authoritative Schedule snapshot for reminder clients.
-- The existing v2 editor remains the mutation owner; v3 only returns the
-- committed linked Schedule in the same database transaction.

create or replace function public.update_my_work_record_details_v3(
  p_record_id uuid,
  p_title text,
  p_due_at timestamptz,
  p_due_has_time boolean default false,
  p_action_kind text default null
)
returns table(
  record_id uuid,
  title_value text,
  due_at_value timestamptz,
  due_has_time boolean,
  action_kind_value text,
  action_kind_changed boolean,
  schedule_updated boolean,
  schedule_id uuid,
  schedule_title text,
  schedule_starts_at timestamptz,
  schedule_status text,
  schedule_all_day boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query
  select
    details.record_id,
    details.title_value,
    details.due_at_value,
    details.due_has_time,
    details.action_kind_value,
    details.action_kind_changed,
    details.schedule_updated,
    linked.id,
    linked.title,
    linked.starts_at,
    linked.status,
    linked.all_day
  from public.update_my_work_record_details_v2(
    p_record_id,
    p_title,
    p_due_at,
    p_due_has_time,
    p_action_kind
  ) details
  left join lateral (
    select s.id, s.title, s.starts_at, s.status, s.all_day
    from public.schedules s
    where s.metadata ->> 'workRecordId' = p_record_id::text
      and s.created_by_user_id = (select auth.uid())
      and s.workspace_id in (
        select w.id from public.workspaces w
        where w.owner_user_id = (select auth.uid()) and w.kind = 'personal'
      )
    order by s.updated_at desc, s.id asc
    limit 1
  ) linked on true;
end;
$$;

revoke all on function public.update_my_work_record_details_v3(uuid,text,timestamptz,boolean,text) from public, anon;
grant execute on function public.update_my_work_record_details_v3(uuid,text,timestamptz,boolean,text) to authenticated, service_role;
