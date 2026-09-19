-- Issue #368 / Stage 3-1: Action Engine + automatic journal data contract.
-- This migration is intentionally backward-compatible with the existing
-- Quick Voice / direct-input writers. It adds journal semantics without
-- forcing legacy records into Task/Note classifications.

alter table public.work_records
  add column action_kind text,
  add column journal_date date,
  add column briefing_state text not null default 'active',
  add column completed_at timestamptz,
  add column acknowledged_at timestamptz;

alter table public.work_records
  add constraint work_records_action_kind_check
    check (action_kind is null or action_kind in ('task', 'note')),
  add constraint work_records_briefing_state_check
    check (briefing_state in ('active', 'acknowledged'));

-- Legacy records get a safe journal baseline from the actual recorded time.
-- Stage 3's Korean Date Engine may explicitly move journal_date for semantic
-- past/future phrases on newly classified records.
update public.work_records
set journal_date = (recorded_at at time zone 'Asia/Seoul')::date
where journal_date is null;

alter table public.work_records
  alter column journal_date set not null;

comment on column public.work_records.action_kind is
  'Stage 3 action classification. task/note only; schedules remain in public.schedules. NULL means legacy or unclassified.';
comment on column public.work_records.journal_date is
  'Asia/Seoul calendar date this record belongs to in the automatic work journal. Distinct from recorded_at and due_at.';
comment on column public.work_records.briefing_state is
  'Whether the record should remain active in briefing-oriented UX. acknowledged removes a Note from active briefing without deleting it.';
comment on column public.work_records.completed_at is
  'Timestamp when a work record entered completed status after Stage 3-1. Cleared if completion is undone.';
comment on column public.work_records.acknowledged_at is
  'Timestamp when briefing_state entered acknowledged. Cleared if acknowledgement is undone.';

create or replace function private.apply_work_record_action_journal_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.journal_date is null then
    new.journal_date := (coalesce(new.recorded_at, now()) at time zone 'Asia/Seoul')::date;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'completed' and new.completed_at is null then
      new.completed_at := now();
    end if;
    if new.briefing_state = 'acknowledged' and new.acknowledged_at is null then
      new.acknowledged_at := now();
    end if;
    return new;
  end if;

  if new.status = 'completed' and old.status is distinct from 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status is distinct from 'completed' and old.status = 'completed' then
    new.completed_at := null;
  end if;

  if new.briefing_state = 'acknowledged'
     and old.briefing_state is distinct from 'acknowledged' then
    new.acknowledged_at := coalesce(new.acknowledged_at, now());
  elsif new.briefing_state = 'active'
        and old.briefing_state = 'acknowledged' then
    new.acknowledged_at := null;
  end if;

  return new;
end;
$$;

revoke all on function private.apply_work_record_action_journal_state() from public, anon, authenticated;
grant execute on function private.apply_work_record_action_journal_state() to service_role;

drop trigger if exists work_records_apply_action_journal_state on public.work_records;
create trigger work_records_apply_action_journal_state
before insert or update of recorded_at, journal_date, status, briefing_state, completed_at, acknowledged_at
on public.work_records
for each row execute function private.apply_work_record_action_journal_state();

create index work_records_workspace_journal_date_idx
  on public.work_records(workspace_id, journal_date desc, recorded_at desc);

create index work_records_workspace_active_notes_idx
  on public.work_records(workspace_id, journal_date desc, recorded_at desc)
  where action_kind = 'note' and briefing_state = 'active';
