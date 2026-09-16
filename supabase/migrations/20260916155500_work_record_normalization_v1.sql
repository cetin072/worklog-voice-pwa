-- Issue #249: Record Normalization 0.1
-- Keep work_records.original_text immutable from normalization and persist derived/search-ready data separately.

create table public.work_record_normalizations (
  work_record_id uuid primary key references public.work_records(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by_user_id uuid references auth.users(id) on delete set null,
  processing_status text not null default 'pending' check (
    processing_status in ('pending', 'processing', 'completed', 'needs_review', 'failed')
  ),
  normalized_title text not null default '' check (char_length(normalized_title) <= 200),
  normalized_text text not null default '' check (char_length(normalized_text) <= 10000),
  structured_data jsonb not null default '{}'::jsonb check (jsonb_typeof(structured_data) = 'object'),
  search_aliases text[] not null default '{}'::text[],
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  review_state text not null default 'unreviewed' check (
    review_state in ('unreviewed', 'needs_review', 'approved')
  ),
  normalization_version text,
  source_quality text not null default 'unknown' check (
    source_quality in ('original', 'fallback_content', 'unknown')
  ),
  platform_job jsonb not null default '{}'::jsonb check (jsonb_typeof(platform_job) = 'object'),
  retry_plan jsonb not null default '{}'::jsonb check (jsonb_typeof(retry_plan) = 'object'),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_retry_at timestamptz,
  last_error_code text,
  last_error_message text,
  normalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index work_record_normalizations_workspace_status_retry_idx
  on public.work_record_normalizations(workspace_id, processing_status, next_retry_at);
create index work_record_normalizations_search_aliases_idx
  on public.work_record_normalizations using gin(search_aliases);

create trigger work_record_normalizations_set_updated_at
before update on public.work_record_normalizations
for each row execute function private.set_updated_at();

alter table public.work_record_normalizations enable row level security;
revoke all on table public.work_record_normalizations from anon;
grant select, insert, update on table public.work_record_normalizations to authenticated, service_role;
grant delete on table public.work_record_normalizations to service_role;

create policy work_record_normalizations_select_member
on public.work_record_normalizations for select
to authenticated
using ((select private.can_access_workspace(workspace_id)));

create policy work_record_normalizations_insert_creator
on public.work_record_normalizations for insert
to authenticated
with check (
  (select private.can_access_workspace(workspace_id))
  and created_by_user_id = (select auth.uid())
  and exists (
    select 1
    from public.work_records wr
    where wr.id = work_record_id
      and wr.workspace_id = workspace_id
      and wr.created_by_user_id = (select auth.uid())
  )
);

create policy work_record_normalizations_update_creator
on public.work_record_normalizations for update
to authenticated
using (
  (select private.can_access_workspace(workspace_id))
  and created_by_user_id = (select auth.uid())
)
with check (
  (select private.can_access_workspace(workspace_id))
  and created_by_user_id = (select auth.uid())
  and exists (
    select 1
    from public.work_records wr
    where wr.id = work_record_id
      and wr.workspace_id = workspace_id
      and wr.created_by_user_id = (select auth.uid())
  )
);

create or replace function private.enqueue_work_record_normalization()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.work_record_normalizations (
    work_record_id,
    workspace_id,
    created_by_user_id,
    processing_status,
    source_quality
  ) values (
    new.id,
    new.workspace_id,
    new.created_by_user_id,
    'pending',
    case when nullif(btrim(new.original_text), '') is null then 'fallback_content' else 'original' end
  )
  on conflict (work_record_id) do nothing;
  return new;
end;
$$;

revoke all on function private.enqueue_work_record_normalization() from public, anon, authenticated;

create trigger work_records_enqueue_normalization
  after insert on public.work_records
  for each row execute function private.enqueue_work_record_normalization();
