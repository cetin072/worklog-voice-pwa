-- Issue #380 / Stage 3-6: automatic date-scoped work journal.
-- The journal is a projection over existing WorkRecords/Schedules, not a copied document store.

create or replace function public.get_my_work_journal_day(
  p_date date
)
returns table (
  workspace_id uuid,
  target_date date,
  today date,
  schedules jsonb,
  completed jsonb,
  notes jsonb,
  open_tasks jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select
      coalesce(p_date, timezone('Asia/Seoul', now())::date) as target_date,
      timezone('Asia/Seoul', now())::date as today
  ),
  my_workspace as (
    select w.id
    from public.workspaces w
    where w.owner_user_id = (select auth.uid())
      and w.kind = 'personal'
    order by w.created_at asc
    limit 1
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
    where s.status <> 'cancelled'
      and s.starts_at >= (p.target_date::timestamp at time zone 'Asia/Seoul')
      and s.starts_at < ((p.target_date + 1)::timestamp at time zone 'Asia/Seoul')
    order by s.starts_at asc
    limit 200
  ),
  completed_rows as (
    select
      wr.id,
      wr.title,
      wr.institution,
      wr.status,
      wr.follow_up,
      wr.journal_date,
      wr.due_at,
      wr.completed_at,
      wr.recorded_at
    from public.work_records wr
    join my_workspace mw on mw.id = wr.workspace_id
    cross join params p
    where wr.status = 'completed'
      and wr.action_kind is distinct from 'note'
      and (wr.metadata #>> '{actionEngine,kind}') is distinct from 'schedule'
      and (
        (
          wr.completed_at is not null
          and (wr.completed_at at time zone 'Asia/Seoul')::date = p.target_date
        )
        or (
          wr.completed_at is null
          and wr.journal_date = p.target_date
        )
      )
    order by coalesce(wr.completed_at, wr.recorded_at) asc
    limit 500
  ),
  note_rows as (
    select
      wr.id,
      wr.title,
      wr.institution,
      wr.briefing_state,
      wr.journal_date,
      wr.recorded_at,
      wr.updated_at
    from public.work_records wr
    join my_workspace mw on mw.id = wr.workspace_id
    cross join params p
    where wr.action_kind = 'note'
      and wr.status <> 'cancelled'
      and wr.journal_date = p.target_date
    order by wr.recorded_at asc
    limit 500
  ),
  open_rows as (
    select
      wr.id,
      wr.title,
      wr.institution,
      wr.status,
      wr.follow_up,
      wr.journal_date,
      wr.due_at,
      wr.recorded_at
    from public.work_records wr
    join my_workspace mw on mw.id = wr.workspace_id
    cross join params p
    where wr.status in ('in_progress', 'waiting', 'needs_review')
      and wr.action_kind is distinct from 'note'
      and (wr.metadata #>> '{actionEngine,kind}') is distinct from 'schedule'
      and (
        case
          when wr.due_at is not null
            then (wr.due_at at time zone 'Asia/Seoul')::date
          else wr.journal_date
        end
      ) = p.target_date
    order by coalesce(wr.due_at, wr.recorded_at) asc
    limit 500
  )
  select
    mw.id,
    p.target_date,
    p.today,
    coalesce(
      (select jsonb_agg(to_jsonb(s) order by s.starts_at asc) from schedule_rows s),
      '[]'::jsonb
    ),
    coalesce(
      (select jsonb_agg(to_jsonb(c) order by coalesce(c.completed_at, c.recorded_at) asc) from completed_rows c),
      '[]'::jsonb
    ),
    coalesce(
      (select jsonb_agg(to_jsonb(n) order by n.recorded_at asc) from note_rows n),
      '[]'::jsonb
    ),
    coalesce(
      (select jsonb_agg(to_jsonb(o) order by coalesce(o.due_at, o.recorded_at) asc) from open_rows o),
      '[]'::jsonb
    )
  from my_workspace mw
  cross join params p;
$$;

revoke all on function public.get_my_work_journal_day(date) from public, anon;
grant execute on function public.get_my_work_journal_day(date) to authenticated, service_role;
