-- 업무수첩 통화/회의 처리용 Supabase 스키마 초안
-- 기준일: 2026-09-13
--
-- IMPORTANT
-- 1) 현재 연결된 taejang-phase1-staging 프로젝트에는 적용하지 않는다.
-- 2) 업무수첩 전용 Supabase 프로젝트가 별도로 확정된 뒤 검토/적용한다.
-- 3) 아래 스키마는 유료 STT/AI 연결 없이 데이터 구조만 정의한다.

create extension if not exists pgcrypto;

create table if not exists public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  request_id text not null unique,
  idempotency_key text not null,
  user_id uuid not null,
  workspace_id uuid,
  kind text not null check (kind in ('call', 'meeting')),
  status text not null default 'queued' check (
    status in ('queued', 'uploading', 'transcribing', 'analyzing', 'persisting', 'completed', 'retry_wait', 'failed', 'cancelled')
  ),
  pipeline_version text not null default 'v1',
  source_filename text,
  source_contact_name text,
  source_phone text,
  source_started_at timestamptz,
  duration_seconds numeric(12,3) not null default 0 check (duration_seconds >= 0),
  temp_object_path text,
  temp_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

-- 같은 사용자/파일/파이프라인에 대해 동시에 중복 작업이 생성되는 것을 막기 위한 키.
create unique index if not exists processing_jobs_user_idempotency_uidx
  on public.processing_jobs (user_id, idempotency_key)
  where status not in ('failed', 'cancelled');

create index if not exists processing_jobs_user_created_idx
  on public.processing_jobs (user_id, created_at desc);

create index if not exists processing_jobs_status_idx
  on public.processing_jobs (status, updated_at);

create index if not exists processing_jobs_temp_expiry_idx
  on public.processing_jobs (temp_expires_at)
  where temp_object_path is not null;

create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.processing_jobs(id) on delete restrict,
  user_id uuid not null,
  workspace_id uuid,
  kind text not null check (kind in ('call', 'meeting')),
  contact_name text,
  phone text,
  occurred_at timestamptz,
  duration_seconds numeric(12,3) not null default 0 check (duration_seconds >= 0),
  transcript text,
  summary text,
  key_points jsonb not null default '[]'::jsonb,
  transcript_retention text not null default 'keep' check (
    transcript_retention in ('keep', '30d', 'delete_after_summary')
  ),
  transcript_delete_after timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists calls_user_occurred_idx
  on public.calls (user_id, occurred_at desc);

create index if not exists calls_transcript_delete_idx
  on public.calls (transcript_delete_after)
  where transcript_delete_after is not null;

create table if not exists public.call_actions (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.calls(id) on delete cascade,
  user_id uuid not null,
  action_type text not null check (action_type in ('task', 'schedule', 'follow_up', 'decision')),
  content text not null,
  -- 날짜만 있는 일정(2026-09-17)과 시간까지 있는 일정(2026-09-17T15:00:00+09:00)을
  -- 기존 업무수첩/Notion 기한 구조와 동일하게 보존한다.
  due_start text,
  due_has_time boolean not null default false,
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  confirmed boolean not null default false,
  source_excerpt text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists call_actions_call_idx
  on public.call_actions (call_id, created_at);

create index if not exists call_actions_user_due_idx
  on public.call_actions (user_id, due_start)
  where due_start is not null;

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  request_id text,
  user_id uuid not null,
  workspace_id uuid,
  feature text not null,
  service text not null,
  provider text,
  model text,
  audio_seconds numeric(14,3) not null default 0 check (audio_seconds >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  image_count integer not null default 0 check (image_count >= 0),
  storage_bytes bigint not null default 0 check (storage_bytes >= 0),
  api_calls integer not null default 1 check (api_calls >= 0),
  native_cost numeric(18,8) not null default 0 check (native_cost >= 0),
  native_currency text not null default 'KRW',
  estimated_cost_krw numeric(18,6) not null default 0 check (estimated_cost_krw >= 0),
  actual_cost_krw numeric(18,6) check (actual_cost_krw is null or actual_cost_krw >= 0),
  related_type text,
  related_id uuid,
  status text not null default 'success' check (status in ('success', 'failed', 'cancelled')),
  provider_request_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists usage_events_user_created_idx
  on public.usage_events (user_id, created_at desc);

create index if not exists usage_events_feature_created_idx
  on public.usage_events (feature, created_at desc);

create index if not exists usage_events_service_created_idx
  on public.usage_events (service, created_at desc);

create index if not exists usage_events_request_idx
  on public.usage_events (request_id)
  where request_id is not null;

-- 실제 적용 시 Supabase Auth 설계와 사용자/워크스페이스 매핑을 확정한 뒤
-- RLS 정책을 추가한다. RLS 정책 없이 클라이언트에 테이블을 직접 노출하지 않는다.
-- 서버(Netlify Functions 또는 별도 API)가 service-role 자격증명을 사용하는 경우에도
-- 해당 자격증명은 브라우저에 절대 노출하지 않는다.
