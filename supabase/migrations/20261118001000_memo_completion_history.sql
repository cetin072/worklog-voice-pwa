-- Read-only correction: retain original records and completion/acknowledgement semantics.
create or replace function worklog.list_my_folder_records(p_folder uuid,p_section text,p_offset integer default 0) returns jsonb
 language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_section not in ('tasks','notes','completed','today') or p_section is null then raise exception 'INVALID_SECTION'; end if;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.sort_at desc,q.id),'[]'::jsonb) into result from (
  select r.id,r.title,r.content,r.original_text,r.status,r.action_kind,r.due_at,r.completed_at,r.recorded_at,r.next_attention_at,r.briefing_state,r.acknowledged_at,
   case when p_section='completed' then coalesce(r.completed_at,r.acknowledged_at,r.recorded_at) else r.recorded_at end as sort_at,
   o.folder_id,o.selected_on,coalesce(o.version,-1) as organization_version
  from worklog.work_records r join worklog.workspaces w on w.id=r.workspace_id
  left join worklog.work_organization o on o.work_record_id=r.id and o.user_id=(select auth.uid())
  where w.kind='personal' and w.owner_user_id=(select auth.uid()) and r.status<>'cancelled'
   and not exists(select 1 from worklog.repeating_work rw where rw.work_record_id=r.id)
   and (r.metadata #>> '{actionEngine,kind}') is distinct from 'schedule'
   and not exists(select 1 from worklog.schedules s where s.workspace_id=r.workspace_id and s.metadata->>'workRecordId'=r.id::text and s.status<>'cancelled')
   and (p_section='today' or o.folder_id is not distinct from p_folder)
   and case p_section
    when 'notes' then r.action_kind='note' and r.status<>'completed' and r.briefing_state='active'
    when 'completed' then r.status='completed' or (r.action_kind='note' and r.briefing_state='acknowledged')
    when 'tasks' then r.status in ('in_progress','waiting','needs_review') and r.action_kind is distinct from 'note'
    when 'today' then r.status in ('in_progress','waiting','needs_review') and r.action_kind is distinct from 'note'
      and o.selected_on <= (now() at time zone 'Asia/Seoul')::date
   end
  order by sort_at desc,r.id limit 50 offset greatest(coalesce(p_offset,0),0)
 ) q;
 return result;
end $$;

-- Issue #380 / Stage 3-6: automatic date-scoped work journal.
-- The journal is a projection over existing WorkRecords/Schedules, not a copied document store.

create or replace function worklog.get_my_work_journal_day(
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
    from worklog.workspaces w
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
    from worklog.schedules s
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
      coalesce(wr.completed_at,wr.acknowledged_at) as completed_at,
      wr.recorded_at
    from worklog.work_records wr
    join my_workspace mw on mw.id = wr.workspace_id
    cross join params p
    where (wr.status = 'completed' or (wr.action_kind = 'note' and wr.briefing_state = 'acknowledged' and wr.status <> 'cancelled'))
      and (wr.metadata #>> '{actionEngine,kind}') is distinct from 'schedule'
      and not exists (
        select 1
        from worklog.schedules linked_schedule
        where linked_schedule.workspace_id = wr.workspace_id
          and linked_schedule.metadata ->> 'workRecordId' = wr.id::text
          and linked_schedule.status <> 'cancelled'
      )
      and (
        (
          coalesce(wr.completed_at,wr.acknowledged_at) is not null
          and (coalesce(wr.completed_at,wr.acknowledged_at) at time zone 'Asia/Seoul')::date = p.target_date
        )
        or (
          coalesce(wr.completed_at,wr.acknowledged_at) is null
          and wr.journal_date = p.target_date
        )
      )
    order by coalesce(wr.completed_at, wr.acknowledged_at, wr.recorded_at) asc
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
    from worklog.work_records wr
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
    from worklog.work_records wr
    join my_workspace mw on mw.id = wr.workspace_id
    cross join params p
    where wr.status in ('in_progress', 'waiting', 'needs_review')
      and wr.action_kind is distinct from 'note'
      and (wr.metadata #>> '{actionEngine,kind}') is distinct from 'schedule'
      and not exists (
        select 1
        from worklog.schedules linked_schedule
        where linked_schedule.workspace_id = wr.workspace_id
          and linked_schedule.metadata ->> 'workRecordId' = wr.id::text
          and linked_schedule.status <> 'cancelled'
      )
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

revoke all on function worklog.get_my_work_journal_day(date) from public, anon;
grant execute on function worklog.get_my_work_journal_day(date) to authenticated, service_role;
