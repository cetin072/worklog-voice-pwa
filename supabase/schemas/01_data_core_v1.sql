-- Data Core V1 declarative schema
-- Issue #123 / Parent #122
-- Structured app data lives in Supabase. Large user originals remain Local-first.

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to authenticated, service_role;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  kind text not null default 'personal' check (kind in ('personal', 'team', 'project')),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.work_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by_user_id uuid references auth.users(id) on delete set null,
  assigned_user_id uuid references auth.users(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  content text not null default '',
  original_text text not null default '',
  record_type text not null default 'other' check (
    record_type in ('completed_work', 'task', 'meeting_call', 'expense_tax', 'delegation', 'idea', 'issue_review', 'other')
  ),
  status text not null default 'in_progress' check (
    status in ('in_progress', 'completed', 'waiting', 'needs_review', 'cancelled')
  ),
  institution text,
  amount numeric(18,2),
  follow_up text,
  recorded_at timestamptz not null default now(),
  due_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by_user_id uuid references auth.users(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  timezone text not null default 'Asia/Seoul' check (char_length(timezone) between 1 and 64),
  status text not null default 'confirmed' check (
    status in ('confirmed', 'tentative', 'completed', 'cancelled')
  ),
  location text,
  reminder_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);

create table public.source_refs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by_user_id uuid references auth.users(id) on delete set null,
  entity_type text not null check (
    entity_type in ('work_record', 'schedule', 'candidate', 'call_report', 'meeting_report', 'scan_document', 'mail_analysis', 'capture_analysis', 'other')
  ),
  entity_id text not null check (char_length(btrim(entity_id)) between 1 and 300),
  source_type text not null check (
    source_type in ('direct', 'voice', 'call', 'meeting', 'mail', 'capture', 'scan', 'notion', 'import', 'other')
  ),
  source_id text check (source_id is null or char_length(source_id) between 1 and 500),
  source_excerpt text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by_user_id uuid references auth.users(id) on delete set null,
  candidate_type text not null check (candidate_type in ('task', 'schedule', 'contact', 'follow_up')),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'dismissed')),
  title text check (title is null or char_length(title) <= 200),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  source_ref_id uuid references public.source_refs(id) on delete set null,
  confirmed_entity_type text,
  confirmed_entity_id text,
  confirmed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'confirmed' and confirmed_at is not null)
    or (status <> 'confirmed')
  )
);

create index workspace_members_user_id_idx on public.workspace_members(user_id);
create index work_records_workspace_recorded_at_idx on public.work_records(workspace_id, recorded_at desc);
create index work_records_workspace_due_at_idx on public.work_records(workspace_id, due_at) where due_at is not null;
create index schedules_workspace_starts_at_idx on public.schedules(workspace_id, starts_at);
create index schedules_workspace_status_starts_at_idx on public.schedules(workspace_id, status, starts_at);
create index source_refs_entity_idx on public.source_refs(workspace_id, entity_type, entity_id);
create index source_refs_source_idx on public.source_refs(workspace_id, source_type, source_id) where source_id is not null;
create index candidates_workspace_status_type_idx on public.candidates(workspace_id, status, candidate_type, created_at desc);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger workspaces_set_updated_at
before update on public.workspaces
for each row execute function private.set_updated_at();

create trigger work_records_set_updated_at
before update on public.work_records
for each row execute function private.set_updated_at();

create trigger schedules_set_updated_at
before update on public.schedules
for each row execute function private.set_updated_at();

create trigger candidates_set_updated_at
before update on public.candidates
for each row execute function private.set_updated_at();

create or replace function private.is_workspace_owner(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.workspaces w
      where w.id = p_workspace_id
        and w.owner_user_id = (select auth.uid())
    );
$$;

create or replace function private.can_access_workspace(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      exists (
        select 1
        from public.workspaces w
        where w.id = p_workspace_id
          and w.owner_user_id = (select auth.uid())
      )
      or exists (
        select 1
        from public.workspace_members wm
        where wm.workspace_id = p_workspace_id
          and wm.user_id = (select auth.uid())
      )
    );
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.is_workspace_owner(uuid) from public, anon;
revoke all on function private.can_access_workspace(uuid) from public, anon;
grant execute on function private.is_workspace_owner(uuid) to authenticated, service_role;
grant execute on function private.can_access_workspace(uuid) to authenticated, service_role;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.work_records enable row level security;
alter table public.schedules enable row level security;
alter table public.source_refs enable row level security;
alter table public.candidates enable row level security;

revoke all on table public.workspaces from anon;
revoke all on table public.workspace_members from anon;
revoke all on table public.work_records from anon;
revoke all on table public.schedules from anon;
revoke all on table public.source_refs from anon;
revoke all on table public.candidates from anon;

grant select, insert, update, delete on table public.workspaces to authenticated, service_role;
grant select, insert, update, delete on table public.workspace_members to authenticated, service_role;
grant select, insert, update, delete on table public.work_records to authenticated, service_role;
grant select, insert, update, delete on table public.schedules to authenticated, service_role;
grant select, insert, update, delete on table public.source_refs to authenticated, service_role;
grant select, insert, update, delete on table public.candidates to authenticated, service_role;

create policy workspaces_select_member
on public.workspaces for select
to authenticated
using ((select private.can_access_workspace(id)));

create policy workspaces_insert_owner
on public.workspaces for insert
to authenticated
with check (
  owner_user_id = (select auth.uid())
  and created_by_user_id = (select auth.uid())
);

create policy workspaces_update_owner
on public.workspaces for update
to authenticated
using ((select private.is_workspace_owner(id)))
with check (owner_user_id = (select auth.uid()));

create policy workspaces_delete_owner
on public.workspaces for delete
to authenticated
using ((select private.is_workspace_owner(id)));

create policy workspace_members_select_member
on public.workspace_members for select
to authenticated
using ((select private.can_access_workspace(workspace_id)));

create policy workspace_members_insert_owner
on public.workspace_members for insert
to authenticated
with check (
  (select private.is_workspace_owner(workspace_id))
  and (role = 'member' or user_id = (select auth.uid()))
);

create policy workspace_members_update_owner
on public.workspace_members for update
to authenticated
using ((select private.is_workspace_owner(workspace_id)))
with check (
  (select private.is_workspace_owner(workspace_id))
  and (role = 'member' or user_id = (select auth.uid()))
);

create policy workspace_members_delete_owner
on public.workspace_members for delete
to authenticated
using ((select private.is_workspace_owner(workspace_id)));

create policy work_records_select_member
on public.work_records for select
to authenticated
using ((select private.can_access_workspace(workspace_id)));

create policy work_records_insert_member
on public.work_records for insert
to authenticated
with check (
  (select private.can_access_workspace(workspace_id))
  and created_by_user_id = (select auth.uid())
);

create policy work_records_update_member
on public.work_records for update
to authenticated
using ((select private.can_access_workspace(workspace_id)))
with check ((select private.can_access_workspace(workspace_id)));

create policy work_records_delete_member
on public.work_records for delete
to authenticated
using ((select private.can_access_workspace(workspace_id)));

create policy schedules_select_member
on public.schedules for select
to authenticated
using ((select private.can_access_workspace(workspace_id)));

create policy schedules_insert_member
on public.schedules for insert
to authenticated
with check (
  (select private.can_access_workspace(workspace_id))
  and created_by_user_id = (select auth.uid())
);

create policy schedules_update_member
on public.schedules for update
to authenticated
using ((select private.can_access_workspace(workspace_id)))
with check ((select private.can_access_workspace(workspace_id)));

create policy schedules_delete_member
on public.schedules for delete
to authenticated
using ((select private.can_access_workspace(workspace_id)));

create policy source_refs_select_member
on public.source_refs for select
to authenticated
using ((select private.can_access_workspace(workspace_id)));

create policy source_refs_insert_member
on public.source_refs for insert
to authenticated
with check (
  (select private.can_access_workspace(workspace_id))
  and created_by_user_id = (select auth.uid())
);

create policy source_refs_update_member
on public.source_refs for update
to authenticated
using ((select private.can_access_workspace(workspace_id)))
with check ((select private.can_access_workspace(workspace_id)));

create policy source_refs_delete_member
on public.source_refs for delete
to authenticated
using ((select private.can_access_workspace(workspace_id)));

create policy candidates_select_member
on public.candidates for select
to authenticated
using ((select private.can_access_workspace(workspace_id)));

create policy candidates_insert_member
on public.candidates for insert
to authenticated
with check (
  (select private.can_access_workspace(workspace_id))
  and created_by_user_id = (select auth.uid())
);

create policy candidates_update_member
on public.candidates for update
to authenticated
using ((select private.can_access_workspace(workspace_id)))
with check ((select private.can_access_workspace(workspace_id)));

create policy candidates_delete_member
on public.candidates for delete
to authenticated
using ((select private.can_access_workspace(workspace_id)));
