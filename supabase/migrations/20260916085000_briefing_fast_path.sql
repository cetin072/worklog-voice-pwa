-- Issue #215: collapse the authenticated Data Core briefing read into one RPC.
-- Keep classification rules in application code; this RPC only returns source rows.

create index if not exists work_records_workspace_status_updated_at_idx
on public.work_records (workspace_id, status, updated_at desc);

create or replace function public.get_my_briefing_source()
returns table (
  workspace_id uuid,
  today date,
  tasks jsonb,
  schedules jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select timezone('Asia/Seoul', now())::date as today
  ),
  my_workspace as (
    select w.id
    from public.workspaces w
    where w.owner_user_id = (select auth.uid())
      and w.kind = 'personal'
    order by w.created_at asc
    limit 1
  ),
  task_rows as (
    select
      wr.id,
      wr.title,
      wr.institution,
      wr.status,
      wr.follow_up,
      wr.due_at,
      wr.updated_at,
      wr.recorded_at,
      wr.metadata
    from public.work_records wr
    join my_workspace mw on mw.id = wr.workspace_id
    where wr.status in ('in_progress', 'waiting', 'needs_review')
    order by wr.updated_at desc
    limit 500
  ),
  schedule_rows as (
    select
      s.id,
      s.title,
      s.starts_at,
      s.all_day,
      s.status,
      s.location
    from public.schedules s
    join my_workspace mw on mw.id = s.workspace_id
    cross join params p
    where s.status in ('confirmed', 'tentative')
      and s.starts_at >= (p.today::timestamp at time zone 'Asia/Seoul')
      and s.starts_at < ((p.today + 15)::timestamp at time zone 'Asia/Seoul')
    order by s.starts_at asc
    limit 100
  )
  select
    mw.id,
    p.today,
    coalesce(
      (select jsonb_agg(to_jsonb(t) order by t.updated_at desc) from task_rows t),
      '[]'::jsonb
    ),
    coalesce(
      (select jsonb_agg(to_jsonb(s) order by s.starts_at asc) from schedule_rows s),
      '[]'::jsonb
    )
  from my_workspace mw
  cross join params p;
$$;

revoke all on function public.get_my_briefing_source() from public, anon;
grant execute on function public.get_my_briefing_source() to authenticated, service_role;
