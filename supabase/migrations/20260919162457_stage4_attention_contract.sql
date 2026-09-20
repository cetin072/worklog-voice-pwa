-- Issue #389 / Stage 4-1: keep the task plan (due_at) independent from the
-- explicit time the user wants to see the task again (next_attention_at).
-- Existing records deliberately remain null: there is no inferred backfill.

alter table public.work_records
  add column if not exists next_attention_at timestamptz null;

create or replace function public.clear_irrelevant_work_record_attention()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status in ('completed', 'cancelled') or new.action_kind = 'note' then
    new.next_attention_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists work_records_clear_irrelevant_attention on public.work_records;
create trigger work_records_clear_irrelevant_attention
before insert or update of status, action_kind, next_attention_at
on public.work_records
for each row
execute function public.clear_irrelevant_work_record_attention();

revoke all on function public.clear_irrelevant_work_record_attention() from public, anon, authenticated;

create index if not exists work_records_workspace_next_attention_at_idx
  on public.work_records (workspace_id, next_attention_at)
  where next_attention_at is not null
    and action_kind = 'task'
    and status in ('in_progress', 'waiting', 'needs_review');
