-- Issue #149: authoritative per-user / per-workspace direct usage and cost ledger.
-- Authenticated clients may read only their own rows. Mutations are reserved for
-- a trusted server writer (service_role) that will be wired separately.

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  schema_version text not null default 'v1',
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null,
  request_id text not null default '',
  job_id text,
  feature text not null,
  service text not null,
  operation text,
  provider text,
  model text,
  provider_request_id text,
  related_type text,
  related_id text,
  status text not null default 'success',
  audio_seconds numeric(18,3) not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  image_count bigint not null default 0,
  storage_bytes bigint not null default 0,
  api_calls bigint not null default 0,
  native_cost numeric(20,8) not null default 0,
  native_currency text not null default 'KRW',
  estimated_cost_krw numeric(20,6) not null default 0,
  actual_cost_krw numeric(20,6),
  pricing_version text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint usage_events_event_key_length check (char_length(event_key) between 1 and 500),
  constraint usage_events_request_id_length check (char_length(request_id) <= 200),
  constraint usage_events_job_id_length check (job_id is null or char_length(job_id) <= 200),
  constraint usage_events_feature_length check (char_length(feature) between 1 and 100),
  constraint usage_events_service_length check (char_length(service) between 1 and 80),
  constraint usage_events_operation_length check (operation is null or char_length(operation) <= 100),
  constraint usage_events_provider_length check (provider is null or char_length(provider) <= 80),
  constraint usage_events_model_length check (model is null or char_length(model) <= 120),
  constraint usage_events_provider_request_id_length check (provider_request_id is null or char_length(provider_request_id) <= 200),
  constraint usage_events_related_type_length check (related_type is null or char_length(related_type) <= 80),
  constraint usage_events_related_id_length check (related_id is null or char_length(related_id) <= 200),
  constraint usage_events_status_check check (status in ('success','failed','cancelled')),
  constraint usage_events_audio_seconds_nonnegative check (audio_seconds >= 0),
  constraint usage_events_input_tokens_nonnegative check (input_tokens >= 0),
  constraint usage_events_output_tokens_nonnegative check (output_tokens >= 0),
  constraint usage_events_image_count_nonnegative check (image_count >= 0),
  constraint usage_events_storage_bytes_nonnegative check (storage_bytes >= 0),
  constraint usage_events_api_calls_nonnegative check (api_calls >= 0),
  constraint usage_events_native_cost_nonnegative check (native_cost >= 0),
  constraint usage_events_estimated_cost_nonnegative check (estimated_cost_krw >= 0),
  constraint usage_events_actual_cost_nonnegative check (actual_cost_krw is null or actual_cost_krw >= 0),
  constraint usage_events_native_currency_length check (char_length(native_currency) between 1 and 8),
  constraint usage_events_pricing_version_length check (pricing_version is null or char_length(pricing_version) <= 80),
  constraint usage_events_schema_version_length check (char_length(schema_version) between 1 and 20),
  constraint usage_events_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create unique index usage_events_workspace_event_key_uidx
  on public.usage_events (workspace_id, event_key);
create index usage_events_user_created_at_idx
  on public.usage_events (user_id, created_at desc);
create index usage_events_workspace_created_at_idx
  on public.usage_events (workspace_id, created_at desc);
create index usage_events_feature_service_created_at_idx
  on public.usage_events (feature, service, created_at desc);

alter table public.usage_events enable row level security;

drop policy if exists usage_events_select_own on public.usage_events;
create policy usage_events_select_own
on public.usage_events
for select
to authenticated
using (
  user_id = (select auth.uid())
  and private.can_access_workspace(workspace_id)
);

revoke all on table public.usage_events from public, anon, authenticated;
grant select on table public.usage_events to authenticated;
grant select, insert, update, delete on table public.usage_events to service_role;

create or replace view public.usage_monthly_direct_cost
with (security_invoker = true)
as
select
  date_trunc('month', created_at)::date as month_start,
  user_id,
  workspace_id,
  count(*)::bigint as event_count,
  sum(audio_seconds)::numeric(20,3) as audio_seconds,
  sum(input_tokens)::bigint as input_tokens,
  sum(output_tokens)::bigint as output_tokens,
  sum(image_count)::bigint as image_count,
  sum(storage_bytes)::bigint as storage_bytes,
  sum(api_calls)::bigint as api_calls,
  sum(estimated_cost_krw)::numeric(20,6) as estimated_cost_krw,
  sum(coalesce(actual_cost_krw, 0))::numeric(20,6) as actual_cost_krw,
  sum(coalesce(actual_cost_krw, estimated_cost_krw))::numeric(20,6) as direct_cost_krw
from public.usage_events
group by date_trunc('month', created_at)::date, user_id, workspace_id;

revoke all on table public.usage_monthly_direct_cost from public, anon, authenticated;
grant select on table public.usage_monthly_direct_cost to authenticated, service_role;

comment on table public.usage_events is 'Authoritative direct usage/cost ledger. Authenticated clients may read only their own rows; trusted server writers own mutations.';
comment on view public.usage_monthly_direct_cost is 'Per-user, per-workspace monthly direct usage/cost rollup using actual KRW cost when present, otherwise estimated KRW cost.';
