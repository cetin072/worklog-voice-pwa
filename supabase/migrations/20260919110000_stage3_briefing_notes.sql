-- Issue #378 / Stage 3-5: separate active Notes from task briefing and add acknowledge/undo mutation.

drop function if exists public.get_my_briefing_source();

create or replace function public.get_my_briefing_source()
returns table (
  workspace_id uuid,
  today date,
  tasks jsonb,
  notes jsonb,
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
      and wr.action_kind is distinct from 'note'
    order by wr.updated_at desc
    limit 500
  ),
  note_rows as (
    select
      wr.id,
      wr.title,
      wr.institution,
      wr.status,
      wr.journal_date,
      wr.recorded_at,
      wr.updated_at
    from public.work_records wr
    join my_workspace mw on mw.id = wr.workspace_id
    where wr.action_kind = 'note'
      and wr.briefing_state = 'active'
      and wr.status in ('in_progress', 'waiting', 'needs_review')
    order by wr.updated_at desc
    limit 100
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
      (select jsonb_agg(to_jsonb(n) order by n.updated_at desc) from note_rows n),
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

create or replace function public.update_my_note_briefing_state(
  p_record_id uuid,
  p_state text
)
returns table (
  record_id uuid,
  briefing_state_value text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  if p_state not in ('active', 'acknowledged') then
    raise exception 'BRIEFING_STATE_INVALID';
  end if;

  select w.id
  into v_workspace_id
  from public.workspaces w
  where w.owner_user_id = v_user_id
    and w.kind = 'personal'
  order by w.created_at asc
  limit 1;

  if v_workspace_id is null then
    raise exception 'PERSONAL_WORKSPACE_MISSING';
  end if;

  return query
  update public.work_records wr
  set briefing_state = p_state
  where wr.id = p_record_id
    and wr.workspace_id = v_workspace_id
    and wr.created_by_user_id = v_user_id
    and wr.action_kind = 'note'
  returning wr.id, wr.briefing_state;
end;
$$;

revoke all on function public.update_my_note_briefing_state(uuid, text) from public, anon;
grant execute on function public.update_my_note_briefing_state(uuid, text) to authenticated, service_role;
