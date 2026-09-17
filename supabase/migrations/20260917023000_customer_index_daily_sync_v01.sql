-- Customer Index Daily Incremental Sync 0.1
-- Issue #309
-- MASTER v5 remains read-only in Google Drive. These tables are the separate LIVE operating copy.

create table public.customer_index_live_identities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  v5_customer_key text not null check (v5_customer_key ~ '^P-[A-F0-9]{12}$'),
  full_name text not null check (char_length(btrim(full_name)) between 1 and 120),
  normalized_name text not null check (char_length(normalized_name) between 1 and 120),
  person_type text not null default '고객후보' check (
    person_type in ('고객', '고객후보', '가족·관계자', '고객여부 미확정')
  ),
  identity_status text not null default '기존 Identity 유지' check (char_length(identity_status) between 1 and 200),
  source_kind text not null default 'master_v5' check (
    source_kind in ('master_v5', 'drive_incremental')
  ),
  source_folder_id text,
  human_locked boolean not null default false,
  active boolean not null default true,
  last_indexed_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, v5_customer_key)
);

create table public.customer_index_sync_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_root_id text not null check (char_length(source_root_id) between 10 and 200),
  status text not null check (status in ('running', 'succeeded', 'noop', 'failed')),
  counts jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),
  checkpoint_before text not null default '',
  checkpoint_after text not null default '',
  error_code text,
  started_at timestamptz not null,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.customer_index_sync_checkpoints (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_root_id text not null check (char_length(source_root_id) between 10 and 200),
  page_token text not null check (char_length(page_token) between 1 and 2000),
  last_successful_at timestamptz not null,
  last_run_id uuid references public.customer_index_sync_runs(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, source_root_id)
);

create table public.customer_index_drive_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  drive_item_id text not null check (char_length(drive_item_id) between 10 and 200),
  source_folder_id text,
  parent_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(parent_ids) = 'array'),
  name text not null default '',
  mime_type text not null default '',
  item_path text not null default '',
  created_time timestamptz,
  modified_time timestamptz,
  md5_checksum text,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  source_state text not null default 'active' check (
    source_state in ('active', 'removed', 'trashed', 'moved_out')
  ),
  normalized_name_candidate text,
  linked_customer_key text,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  last_indexed_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, drive_item_id),
  foreign key (workspace_id, linked_customer_key)
    references public.customer_index_live_identities(workspace_id, v5_customer_key)
    on delete restrict
);

create table public.customer_index_source_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  drive_item_id text not null,
  customer_key text not null,
  link_type text not null check (link_type in ('master_v5', 'human_confirmed', 'drive_lineage', 'new_folder')),
  confidence numeric(5,4) not null check (confidence >= 0 and confidence <= 1),
  human_confirmed boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, drive_item_id),
  foreign key (workspace_id, drive_item_id)
    references public.customer_index_drive_items(workspace_id, drive_item_id)
    on delete restrict,
  foreign key (workspace_id, customer_key)
    references public.customer_index_live_identities(workspace_id, v5_customer_key)
    on delete restrict
);

create table public.customer_index_review_queue (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id uuid not null references public.customer_index_sync_runs(id) on delete restrict,
  drive_item_id text not null,
  source_folder_id text,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'resolved', 'dismissed')),
  reason text not null check (char_length(reason) between 1 and 100),
  candidate_names jsonb not null default '[]'::jsonb check (jsonb_typeof(candidate_names) = 'array'),
  candidate_customer_keys jsonb not null default '[]'::jsonb check (jsonb_typeof(candidate_customer_keys) = 'array'),
  source_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(source_snapshot) = 'object'),
  resolution jsonb not null default '{}'::jsonb check (jsonb_typeof(resolution) = 'object'),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, drive_item_id, fingerprint),
  foreign key (workspace_id, drive_item_id)
    references public.customer_index_drive_items(workspace_id, drive_item_id)
    on delete restrict
);

create table public.customer_index_sync_events (
  event_key text primary key check (event_key ~ '^[a-f0-9]{64}$'),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id uuid not null references public.customer_index_sync_runs(id) on delete restrict,
  drive_item_id text not null,
  decision text not null check (
    decision in ('existing_identity', 'new_identity', 'review_required', 'source_unavailable', 'ignored')
  ),
  customer_key text,
  review_required boolean not null default false,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, drive_item_id)
    references public.customer_index_drive_items(workspace_id, drive_item_id)
    on delete restrict,
  foreign key (workspace_id, customer_key)
    references public.customer_index_live_identities(workspace_id, v5_customer_key)
    on delete restrict
);

create index customer_index_live_name_idx
  on public.customer_index_live_identities(workspace_id, normalized_name)
  where active;
create index customer_index_live_source_folder_idx
  on public.customer_index_live_identities(workspace_id, source_folder_id)
  where source_folder_id is not null;
create index customer_index_runs_started_idx
  on public.customer_index_sync_runs(workspace_id, started_at desc);
create index customer_index_drive_modified_idx
  on public.customer_index_drive_items(workspace_id, modified_time desc);
create index customer_index_drive_folder_idx
  on public.customer_index_drive_items(workspace_id, source_folder_id);
create index customer_index_links_customer_idx
  on public.customer_index_source_links(workspace_id, customer_key)
  where active;
create index customer_index_review_pending_idx
  on public.customer_index_review_queue(workspace_id, created_at)
  where status = 'pending';
create index customer_index_events_run_idx
  on public.customer_index_sync_events(run_id, created_at);

create trigger customer_index_live_identities_set_updated_at
before update on public.customer_index_live_identities
for each row execute function private.set_updated_at();

create trigger customer_index_sync_checkpoints_set_updated_at
before update on public.customer_index_sync_checkpoints
for each row execute function private.set_updated_at();

create trigger customer_index_drive_items_set_updated_at
before update on public.customer_index_drive_items
for each row execute function private.set_updated_at();

create trigger customer_index_source_links_set_updated_at
before update on public.customer_index_source_links
for each row execute function private.set_updated_at();

create trigger customer_index_review_queue_set_updated_at
before update on public.customer_index_review_queue
for each row execute function private.set_updated_at();

alter table public.customer_index_live_identities enable row level security;
alter table public.customer_index_sync_runs enable row level security;
alter table public.customer_index_sync_checkpoints enable row level security;
alter table public.customer_index_drive_items enable row level security;
alter table public.customer_index_source_links enable row level security;
alter table public.customer_index_review_queue enable row level security;
alter table public.customer_index_sync_events enable row level security;

revoke all on table public.customer_index_live_identities from anon, authenticated;
revoke all on table public.customer_index_sync_runs from anon, authenticated;
revoke all on table public.customer_index_sync_checkpoints from anon, authenticated;
revoke all on table public.customer_index_drive_items from anon, authenticated;
revoke all on table public.customer_index_source_links from anon, authenticated;
revoke all on table public.customer_index_review_queue from anon, authenticated;
revoke all on table public.customer_index_sync_events from anon, authenticated;

grant select, insert, update, delete on table public.customer_index_live_identities to service_role;
grant select, insert, update, delete on table public.customer_index_sync_runs to service_role;
grant select, insert, update, delete on table public.customer_index_sync_checkpoints to service_role;
grant select, insert, update, delete on table public.customer_index_drive_items to service_role;
grant select, insert, update, delete on table public.customer_index_source_links to service_role;
grant select, insert, update, delete on table public.customer_index_review_queue to service_role;
grant select, insert, update, delete on table public.customer_index_sync_events to service_role;
