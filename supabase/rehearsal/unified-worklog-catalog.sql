-- REHEARSAL ONLY: catalog snapshot; no application rows or Auth credentials.
-- Not a production migration. Source: worklog live schema, 2026-11-02.
create schema worklog;
create schema worklog_private;
revoke all on schema worklog_private from public;
grant usage on schema worklog,worklog_private to authenticated,service_role;
create table worklog."candidates" (
"id" uuid default gen_random_uuid() not null,
"workspace_id" uuid not null,
"created_by_user_id" uuid,
"candidate_type" text not null,
"status" text default 'pending'::text not null,
"title" text,
"payload" jsonb default '{}'::jsonb not null,
"confidence" numeric(5,4),
"source_ref_id" uuid,
"confirmed_entity_type" text,
"confirmed_entity_id" text,
"confirmed_at" timestamp with time zone,
"metadata" jsonb default '{}'::jsonb not null,
"created_at" timestamp with time zone default now() not null,
"updated_at" timestamp with time zone default now() not null
);
create table worklog."input_captures" (
"id" uuid default gen_random_uuid() not null,
"workspace_id" uuid not null,
"created_by_user_id" uuid,
"client_request_id" text not null,
"source_type" text default 'direct'::text not null,
"original_text" text default ''::text not null,
"recorded_at" timestamp with time zone default now() not null,
"metadata" jsonb default '{}'::jsonb not null,
"created_at" timestamp with time zone default now() not null,
"updated_at" timestamp with time zone default now() not null
);
create table worklog."notification_deliveries" (
"id" uuid default gen_random_uuid() not null,
"workspace_id" uuid not null,
"user_id" uuid not null,
"subscription_id" uuid not null,
"kind" text not null,
"local_date" date not null,
"status" text default 'pending'::text not null,
"error_status" integer,
"error_code" text,
"metadata" jsonb default '{}'::jsonb not null,
"created_at" timestamp with time zone default now() not null,
"updated_at" timestamp with time zone default now() not null,
"sent_at" timestamp with time zone
);
create table worklog."notification_preferences" (
"workspace_id" uuid not null,
"user_id" uuid not null,
"morning_enabled" boolean default false not null,
"morning_time" time without time zone default '08:30:00'::time without time zone not null,
"timezone" text default 'Asia/Seoul'::text not null,
"created_at" timestamp with time zone default now() not null,
"updated_at" timestamp with time zone default now() not null,
"morning_detail_enabled" boolean default true not null,
"afternoon_enabled" boolean default false not null,
"afternoon_time" time without time zone default '16:30:00'::time without time zone not null
);
create table worklog."push_subscriptions" (
"id" uuid default gen_random_uuid() not null,
"workspace_id" uuid not null,
"user_id" uuid not null,
"endpoint" text not null,
"p256dh" text not null,
"auth_secret" text not null,
"user_agent" text default ''::text not null,
"disabled_at" timestamp with time zone,
"last_success_at" timestamp with time zone,
"last_failure_at" timestamp with time zone,
"created_at" timestamp with time zone default now() not null,
"updated_at" timestamp with time zone default now() not null,
"last_failure_status" integer,
"last_failure_code" text,
"app_origin" text
);
create table worklog."schedules" (
"id" uuid default gen_random_uuid() not null,
"workspace_id" uuid not null,
"created_by_user_id" uuid,
"title" text not null,
"description" text default ''::text not null,
"starts_at" timestamp with time zone not null,
"ends_at" timestamp with time zone,
"all_day" boolean default false not null,
"timezone" text default 'Asia/Seoul'::text not null,
"status" text default 'confirmed'::text not null,
"location" text,
"reminder_at" timestamp with time zone,
"metadata" jsonb default '{}'::jsonb not null,
"created_at" timestamp with time zone default now() not null,
"updated_at" timestamp with time zone default now() not null
);
create table worklog."shared_cost_allocations" (
"id" uuid default gen_random_uuid() not null,
"pool_id" uuid not null,
"month_start" date not null,
"user_id" uuid not null,
"workspace_id" uuid not null,
"allocation_method" text not null,
"allocation_weight" numeric(20,12) not null,
"allocated_cost_krw" numeric(20,6) not null,
"created_at" timestamp with time zone default now() not null
);
create table worklog."shared_cost_pools" (
"id" uuid default gen_random_uuid() not null,
"month_start" date not null,
"cost_key" text not null,
"provider" text not null,
"category" text not null,
"amount_krw" numeric(20,6) not null,
"allocation_method" text default 'equal_active_user'::text not null,
"source_note" text,
"metadata" jsonb default '{}'::jsonb not null,
"created_at" timestamp with time zone default now() not null,
"updated_at" timestamp with time zone default now() not null
);
create table worklog."source_refs" (
"id" uuid default gen_random_uuid() not null,
"workspace_id" uuid not null,
"created_by_user_id" uuid,
"entity_type" text not null,
"entity_id" text not null,
"source_type" text not null,
"source_id" text,
"source_excerpt" text,
"metadata" jsonb default '{}'::jsonb not null,
"created_at" timestamp with time zone default now() not null,
"client_request_id" text
);
create table worklog."usage_events" (
"id" uuid default gen_random_uuid() not null,
"schema_version" text default 'v1'::text not null,
"workspace_id" uuid not null,
"user_id" uuid not null,
"event_key" text not null,
"request_id" text default ''::text not null,
"job_id" text,
"feature" text not null,
"service" text not null,
"operation" text,
"provider" text,
"model" text,
"provider_request_id" text,
"related_type" text,
"related_id" text,
"status" text default 'success'::text not null,
"audio_seconds" numeric(18,3) default 0 not null,
"input_tokens" bigint default 0 not null,
"output_tokens" bigint default 0 not null,
"image_count" bigint default 0 not null,
"storage_bytes" bigint default 0 not null,
"api_calls" bigint default 0 not null,
"native_cost" numeric(20,8) default 0 not null,
"native_currency" text default 'KRW'::text not null,
"estimated_cost_krw" numeric(20,6) default 0 not null,
"actual_cost_krw" numeric(20,6),
"pricing_version" text,
"metadata" jsonb default '{}'::jsonb not null,
"created_at" timestamp with time zone default now() not null
);
create table worklog."work_record_normalizations" (
"work_record_id" uuid not null,
"workspace_id" uuid not null,
"created_by_user_id" uuid,
"processing_status" text default 'pending'::text not null,
"normalized_title" text default ''::text not null,
"normalized_text" text default ''::text not null,
"structured_data" jsonb default '{}'::jsonb not null,
"search_aliases" text[] default '{}'::text[] not null,
"confidence" numeric(5,4),
"review_state" text default 'unreviewed'::text not null,
"normalization_version" text,
"source_quality" text default 'unknown'::text not null,
"platform_job" jsonb default '{}'::jsonb not null,
"retry_plan" jsonb default '{}'::jsonb not null,
"attempt_count" integer default 0 not null,
"next_retry_at" timestamp with time zone,
"last_error_code" text,
"last_error_message" text,
"normalized_at" timestamp with time zone,
"created_at" timestamp with time zone default now() not null,
"updated_at" timestamp with time zone default now() not null
);
create table worklog."work_records" (
"id" uuid default gen_random_uuid() not null,
"workspace_id" uuid not null,
"created_by_user_id" uuid,
"assigned_user_id" uuid,
"title" text not null,
"content" text default ''::text not null,
"original_text" text default ''::text not null,
"record_type" text default 'other'::text not null,
"status" text default 'in_progress'::text not null,
"institution" text,
"amount" numeric(18,2),
"follow_up" text,
"recorded_at" timestamp with time zone default now() not null,
"due_at" timestamp with time zone,
"metadata" jsonb default '{}'::jsonb not null,
"created_at" timestamp with time zone default now() not null,
"updated_at" timestamp with time zone default now() not null,
"client_request_id" text,
"action_kind" text,
"journal_date" date not null,
"briefing_state" text default 'active'::text not null,
"completed_at" timestamp with time zone,
"acknowledged_at" timestamp with time zone,
"next_attention_at" timestamp with time zone
);
create table worklog."workspace_members" (
"workspace_id" uuid not null,
"user_id" uuid not null,
"role" text not null,
"metadata" jsonb default '{}'::jsonb not null,
"joined_at" timestamp with time zone default now() not null
);
create table worklog."workspaces" (
"id" uuid default gen_random_uuid() not null,
"name" text not null,
"kind" text default 'personal'::text not null,
"owner_user_id" uuid not null,
"created_by_user_id" uuid not null,
"metadata" jsonb default '{}'::jsonb not null,
"created_at" timestamp with time zone default now() not null,
"updated_at" timestamp with time zone default now() not null
);
alter table worklog."candidates" add constraint "candidates_candidate_type_check" CHECK ((candidate_type = ANY (ARRAY['task'::text, 'schedule'::text, 'contact'::text, 'follow_up'::text])));
alter table worklog."candidates" add constraint "candidates_check" CHECK ((((status = 'confirmed'::text) AND (confirmed_at IS NOT NULL)) OR (status <> 'confirmed'::text)));
alter table worklog."candidates" add constraint "candidates_confidence_check" CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))));
alter table worklog."candidates" add constraint "candidates_metadata_check" CHECK ((jsonb_typeof(metadata) = 'object'::text));
alter table worklog."candidates" add constraint "candidates_payload_check" CHECK ((jsonb_typeof(payload) = 'object'::text));
alter table worklog."candidates" add constraint "candidates_pkey" PRIMARY KEY (id);
alter table worklog."candidates" add constraint "candidates_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'dismissed'::text])));
alter table worklog."candidates" add constraint "candidates_title_check" CHECK (((title IS NULL) OR (char_length(title) <= 200)));
alter table worklog."input_captures" add constraint "input_captures_client_request_id_check" CHECK (((char_length(btrim(client_request_id)) >= 16) AND (char_length(btrim(client_request_id)) <= 100)));
alter table worklog."input_captures" add constraint "input_captures_metadata_check" CHECK ((jsonb_typeof(metadata) = 'object'::text));
alter table worklog."input_captures" add constraint "input_captures_original_text_check" CHECK ((char_length(original_text) <= 10000));
alter table worklog."input_captures" add constraint "input_captures_pkey" PRIMARY KEY (id);
alter table worklog."input_captures" add constraint "input_captures_source_type_check" CHECK ((source_type = ANY (ARRAY['direct'::text, 'voice'::text, 'call'::text, 'meeting'::text, 'mail'::text, 'capture'::text, 'scan'::text, 'notion'::text, 'import'::text, 'other'::text])));
alter table worklog."input_captures" add constraint "input_captures_workspace_id_client_request_id_key" UNIQUE (workspace_id, client_request_id);
alter table worklog."notification_deliveries" add constraint "notification_deliveries_error_code_check" CHECK (((error_code IS NULL) OR (char_length(error_code) <= 80)));
alter table worklog."notification_deliveries" add constraint "notification_deliveries_error_status_check" CHECK (((error_status IS NULL) OR ((error_status >= 100) AND (error_status <= 599))));
alter table worklog."notification_deliveries" add constraint "notification_deliveries_kind_check" CHECK ((kind = ANY (ARRAY['morning_digest'::text, 'afternoon_incomplete'::text])));
alter table worklog."notification_deliveries" add constraint "notification_deliveries_metadata_check" CHECK ((jsonb_typeof(metadata) = 'object'::text));
alter table worklog."notification_deliveries" add constraint "notification_deliveries_pkey" PRIMARY KEY (id);
alter table worklog."notification_deliveries" add constraint "notification_deliveries_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text])));
alter table worklog."notification_deliveries" add constraint "notification_deliveries_subscription_id_kind_local_date_key" UNIQUE (subscription_id, kind, local_date);
alter table worklog."notification_preferences" add constraint "notification_preferences_afternoon_time_check" CHECK ((afternoon_time = '16:30:00'::time without time zone));
alter table worklog."notification_preferences" add constraint "notification_preferences_morning_time_check" CHECK ((morning_time = '08:30:00'::time without time zone));
alter table worklog."notification_preferences" add constraint "notification_preferences_pkey" PRIMARY KEY (workspace_id, user_id);
alter table worklog."notification_preferences" add constraint "notification_preferences_timezone_check" CHECK ((timezone = 'Asia/Seoul'::text));
alter table worklog."push_subscriptions" add constraint "push_subscriptions_app_origin_https_check" CHECK (((app_origin IS NULL) OR (app_origin ~ '^https://[^/]+$'::text)));
alter table worklog."push_subscriptions" add constraint "push_subscriptions_auth_length" CHECK (((char_length(auth_secret) >= 8) AND (char_length(auth_secret) <= 256)));
alter table worklog."push_subscriptions" add constraint "push_subscriptions_endpoint_length" CHECK (((char_length(endpoint) >= 20) AND (char_length(endpoint) <= 2048)));
alter table worklog."push_subscriptions" add constraint "push_subscriptions_failure_code_length" CHECK (((last_failure_code IS NULL) OR (char_length(last_failure_code) <= 80)));
alter table worklog."push_subscriptions" add constraint "push_subscriptions_failure_status_range" CHECK (((last_failure_status IS NULL) OR ((last_failure_status >= 100) AND (last_failure_status <= 599))));
alter table worklog."push_subscriptions" add constraint "push_subscriptions_p256dh_length" CHECK (((char_length(p256dh) >= 20) AND (char_length(p256dh) <= 512)));
alter table worklog."push_subscriptions" add constraint "push_subscriptions_pkey" PRIMARY KEY (id);
alter table worklog."push_subscriptions" add constraint "push_subscriptions_user_agent_length" CHECK ((char_length(user_agent) <= 500));
alter table worklog."push_subscriptions" add constraint "push_subscriptions_user_endpoint_unique" UNIQUE (user_id, endpoint);
alter table worklog."schedules" add constraint "schedules_check" CHECK (((ends_at IS NULL) OR (ends_at >= starts_at)));
alter table worklog."schedules" add constraint "schedules_metadata_check" CHECK ((jsonb_typeof(metadata) = 'object'::text));
alter table worklog."schedules" add constraint "schedules_pkey" PRIMARY KEY (id);
alter table worklog."schedules" add constraint "schedules_status_check" CHECK ((status = ANY (ARRAY['confirmed'::text, 'tentative'::text, 'completed'::text, 'cancelled'::text])));
alter table worklog."schedules" add constraint "schedules_timezone_check" CHECK (((char_length(timezone) >= 1) AND (char_length(timezone) <= 64)));
alter table worklog."schedules" add constraint "schedules_title_check" CHECK (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 200)));
alter table worklog."shared_cost_allocations" add constraint "shared_cost_allocations_cost_nonnegative" CHECK ((allocated_cost_krw >= (0)::numeric));
alter table worklog."shared_cost_allocations" add constraint "shared_cost_allocations_method_check" CHECK ((allocation_method = 'equal_active_user'::text));
alter table worklog."shared_cost_allocations" add constraint "shared_cost_allocations_month_start_check" CHECK ((month_start = (date_trunc('month'::text, (month_start)::timestamp without time zone))::date));
alter table worklog."shared_cost_allocations" add constraint "shared_cost_allocations_pkey" PRIMARY KEY (id);
alter table worklog."shared_cost_allocations" add constraint "shared_cost_allocations_unique" UNIQUE (pool_id, user_id, workspace_id);
alter table worklog."shared_cost_allocations" add constraint "shared_cost_allocations_weight_check" CHECK (((allocation_weight > (0)::numeric) AND (allocation_weight <= (1)::numeric)));
alter table worklog."shared_cost_pools" add constraint "shared_cost_pools_allocation_method_check" CHECK ((allocation_method = 'equal_active_user'::text));
alter table worklog."shared_cost_pools" add constraint "shared_cost_pools_amount_nonnegative" CHECK ((amount_krw >= (0)::numeric));
alter table worklog."shared_cost_pools" add constraint "shared_cost_pools_category_check" CHECK ((category = ANY (ARRAY['database'::text, 'hosting'::text, 'domain'::text, 'storage'::text, 'network'::text, 'observability'::text, 'other'::text])));
alter table worklog."shared_cost_pools" add constraint "shared_cost_pools_cost_key_length" CHECK (((char_length(cost_key) >= 1) AND (char_length(cost_key) <= 120)));
alter table worklog."shared_cost_pools" add constraint "shared_cost_pools_metadata_object" CHECK ((jsonb_typeof(metadata) = 'object'::text));
alter table worklog."shared_cost_pools" add constraint "shared_cost_pools_month_key_unique" UNIQUE (month_start, cost_key);
alter table worklog."shared_cost_pools" add constraint "shared_cost_pools_month_start_check" CHECK ((month_start = (date_trunc('month'::text, (month_start)::timestamp without time zone))::date));
alter table worklog."shared_cost_pools" add constraint "shared_cost_pools_pkey" PRIMARY KEY (id);
alter table worklog."shared_cost_pools" add constraint "shared_cost_pools_provider_length" CHECK (((char_length(provider) >= 1) AND (char_length(provider) <= 80)));
alter table worklog."shared_cost_pools" add constraint "shared_cost_pools_source_note_length" CHECK (((source_note IS NULL) OR (char_length(source_note) <= 1000)));
alter table worklog."source_refs" add constraint "source_refs_client_request_id_format_check" CHECK (((client_request_id IS NULL) OR ((char_length(client_request_id) >= 16) AND (char_length(client_request_id) <= 100))));
alter table worklog."source_refs" add constraint "source_refs_entity_id_check" CHECK (((char_length(btrim(entity_id)) >= 1) AND (char_length(btrim(entity_id)) <= 300)));
alter table worklog."source_refs" add constraint "source_refs_entity_type_check" CHECK ((entity_type = ANY (ARRAY['work_record'::text, 'schedule'::text, 'candidate'::text, 'call_report'::text, 'meeting_report'::text, 'scan_document'::text, 'mail_analysis'::text, 'capture_analysis'::text, 'other'::text])));
alter table worklog."source_refs" add constraint "source_refs_metadata_check" CHECK ((jsonb_typeof(metadata) = 'object'::text));
alter table worklog."source_refs" add constraint "source_refs_pkey" PRIMARY KEY (id);
alter table worklog."source_refs" add constraint "source_refs_source_id_check" CHECK (((source_id IS NULL) OR ((char_length(source_id) >= 1) AND (char_length(source_id) <= 500))));
alter table worklog."source_refs" add constraint "source_refs_source_type_check" CHECK ((source_type = ANY (ARRAY['direct'::text, 'voice'::text, 'call'::text, 'meeting'::text, 'mail'::text, 'capture'::text, 'scan'::text, 'notion'::text, 'import'::text, 'other'::text])));
alter table worklog."source_refs" add constraint "source_refs_workspace_client_request_id_key" UNIQUE (workspace_id, client_request_id);
alter table worklog."usage_events" add constraint "usage_events_actual_cost_nonnegative" CHECK (((actual_cost_krw IS NULL) OR (actual_cost_krw >= (0)::numeric)));
alter table worklog."usage_events" add constraint "usage_events_api_calls_nonnegative" CHECK ((api_calls >= 0));
alter table worklog."usage_events" add constraint "usage_events_audio_seconds_nonnegative" CHECK ((audio_seconds >= (0)::numeric));
alter table worklog."usage_events" add constraint "usage_events_estimated_cost_nonnegative" CHECK ((estimated_cost_krw >= (0)::numeric));
alter table worklog."usage_events" add constraint "usage_events_event_key_length" CHECK (((char_length(event_key) >= 1) AND (char_length(event_key) <= 500)));
alter table worklog."usage_events" add constraint "usage_events_feature_length" CHECK (((char_length(feature) >= 1) AND (char_length(feature) <= 100)));
alter table worklog."usage_events" add constraint "usage_events_image_count_nonnegative" CHECK ((image_count >= 0));
alter table worklog."usage_events" add constraint "usage_events_input_tokens_nonnegative" CHECK ((input_tokens >= 0));
alter table worklog."usage_events" add constraint "usage_events_job_id_length" CHECK (((job_id IS NULL) OR (char_length(job_id) <= 200)));
alter table worklog."usage_events" add constraint "usage_events_metadata_object" CHECK ((jsonb_typeof(metadata) = 'object'::text));
alter table worklog."usage_events" add constraint "usage_events_model_length" CHECK (((model IS NULL) OR (char_length(model) <= 120)));
alter table worklog."usage_events" add constraint "usage_events_native_cost_nonnegative" CHECK ((native_cost >= (0)::numeric));
alter table worklog."usage_events" add constraint "usage_events_native_currency_length" CHECK (((char_length(native_currency) >= 1) AND (char_length(native_currency) <= 8)));
alter table worklog."usage_events" add constraint "usage_events_operation_length" CHECK (((operation IS NULL) OR (char_length(operation) <= 100)));
alter table worklog."usage_events" add constraint "usage_events_output_tokens_nonnegative" CHECK ((output_tokens >= 0));
alter table worklog."usage_events" add constraint "usage_events_pkey" PRIMARY KEY (id);
alter table worklog."usage_events" add constraint "usage_events_pricing_version_length" CHECK (((pricing_version IS NULL) OR (char_length(pricing_version) <= 80)));
alter table worklog."usage_events" add constraint "usage_events_provider_length" CHECK (((provider IS NULL) OR (char_length(provider) <= 80)));
alter table worklog."usage_events" add constraint "usage_events_provider_request_id_length" CHECK (((provider_request_id IS NULL) OR (char_length(provider_request_id) <= 200)));
alter table worklog."usage_events" add constraint "usage_events_related_id_length" CHECK (((related_id IS NULL) OR (char_length(related_id) <= 200)));
alter table worklog."usage_events" add constraint "usage_events_related_type_length" CHECK (((related_type IS NULL) OR (char_length(related_type) <= 80)));
alter table worklog."usage_events" add constraint "usage_events_request_id_length" CHECK ((char_length(request_id) <= 200));
alter table worklog."usage_events" add constraint "usage_events_schema_version_length" CHECK (((char_length(schema_version) >= 1) AND (char_length(schema_version) <= 20)));
alter table worklog."usage_events" add constraint "usage_events_service_length" CHECK (((char_length(service) >= 1) AND (char_length(service) <= 80)));
alter table worklog."usage_events" add constraint "usage_events_status_check" CHECK ((status = ANY (ARRAY['success'::text, 'failed'::text, 'cancelled'::text])));
alter table worklog."usage_events" add constraint "usage_events_storage_bytes_nonnegative" CHECK ((storage_bytes >= 0));
alter table worklog."work_record_normalizations" add constraint "work_record_normalizations_attempt_count_check" CHECK ((attempt_count >= 0));
alter table worklog."work_record_normalizations" add constraint "work_record_normalizations_confidence_check" CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))));
alter table worklog."work_record_normalizations" add constraint "work_record_normalizations_normalized_text_check" CHECK ((char_length(normalized_text) <= 10000));
alter table worklog."work_record_normalizations" add constraint "work_record_normalizations_normalized_title_check" CHECK ((char_length(normalized_title) <= 200));
alter table worklog."work_record_normalizations" add constraint "work_record_normalizations_pkey" PRIMARY KEY (work_record_id);
alter table worklog."work_record_normalizations" add constraint "work_record_normalizations_platform_job_check" CHECK ((jsonb_typeof(platform_job) = 'object'::text));
alter table worklog."work_record_normalizations" add constraint "work_record_normalizations_processing_status_check" CHECK ((processing_status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'needs_review'::text, 'failed'::text])));
alter table worklog."work_record_normalizations" add constraint "work_record_normalizations_retry_plan_check" CHECK ((jsonb_typeof(retry_plan) = 'object'::text));
alter table worklog."work_record_normalizations" add constraint "work_record_normalizations_review_state_check" CHECK ((review_state = ANY (ARRAY['unreviewed'::text, 'needs_review'::text, 'approved'::text])));
alter table worklog."work_record_normalizations" add constraint "work_record_normalizations_source_quality_check" CHECK ((source_quality = ANY (ARRAY['original'::text, 'fallback_content'::text, 'unknown'::text])));
alter table worklog."work_record_normalizations" add constraint "work_record_normalizations_structured_data_check" CHECK ((jsonb_typeof(structured_data) = 'object'::text));
alter table worklog."work_records" add constraint "work_records_action_kind_check" CHECK (((action_kind IS NULL) OR (action_kind = ANY (ARRAY['task'::text, 'note'::text]))));
alter table worklog."work_records" add constraint "work_records_briefing_state_check" CHECK ((briefing_state = ANY (ARRAY['active'::text, 'acknowledged'::text])));
alter table worklog."work_records" add constraint "work_records_client_request_id_format_check" CHECK (((client_request_id IS NULL) OR ((char_length(client_request_id) >= 16) AND (char_length(client_request_id) <= 100))));
alter table worklog."work_records" add constraint "work_records_metadata_check" CHECK ((jsonb_typeof(metadata) = 'object'::text));
alter table worklog."work_records" add constraint "work_records_pkey" PRIMARY KEY (id);
alter table worklog."work_records" add constraint "work_records_record_type_check" CHECK ((record_type = ANY (ARRAY['completed_work'::text, 'task'::text, 'meeting_call'::text, 'expense_tax'::text, 'delegation'::text, 'idea'::text, 'issue_review'::text, 'other'::text])));
alter table worklog."work_records" add constraint "work_records_status_check" CHECK ((status = ANY (ARRAY['in_progress'::text, 'completed'::text, 'waiting'::text, 'needs_review'::text, 'cancelled'::text])));
alter table worklog."work_records" add constraint "work_records_title_check" CHECK (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 200)));
alter table worklog."work_records" add constraint "work_records_workspace_client_request_id_key" UNIQUE (workspace_id, client_request_id);
alter table worklog."workspace_members" add constraint "workspace_members_metadata_check" CHECK ((jsonb_typeof(metadata) = 'object'::text));
alter table worklog."workspace_members" add constraint "workspace_members_pkey" PRIMARY KEY (workspace_id, user_id);
alter table worklog."workspace_members" add constraint "workspace_members_role_check" CHECK ((role = ANY (ARRAY['owner'::text, 'member'::text])));
alter table worklog."workspaces" add constraint "workspaces_kind_check" CHECK ((kind = ANY (ARRAY['personal'::text, 'team'::text, 'project'::text])));
alter table worklog."workspaces" add constraint "workspaces_metadata_check" CHECK ((jsonb_typeof(metadata) = 'object'::text));
alter table worklog."workspaces" add constraint "workspaces_name_check" CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 120)));
alter table worklog."workspaces" add constraint "workspaces_pkey" PRIMARY KEY (id);
alter table worklog."candidates" add constraint "candidates_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table worklog."candidates" add constraint "candidates_source_ref_id_fkey" FOREIGN KEY (source_ref_id) REFERENCES worklog.source_refs(id) ON DELETE SET NULL;
alter table worklog."candidates" add constraint "candidates_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES worklog.workspaces(id) ON DELETE CASCADE;
alter table worklog."input_captures" add constraint "input_captures_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table worklog."input_captures" add constraint "input_captures_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES worklog.workspaces(id) ON DELETE CASCADE;
alter table worklog."notification_deliveries" add constraint "notification_deliveries_subscription_id_fkey" FOREIGN KEY (subscription_id) REFERENCES worklog.push_subscriptions(id) ON DELETE CASCADE;
alter table worklog."notification_deliveries" add constraint "notification_deliveries_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table worklog."notification_deliveries" add constraint "notification_deliveries_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES worklog.workspaces(id) ON DELETE CASCADE;
alter table worklog."notification_preferences" add constraint "notification_preferences_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table worklog."notification_preferences" add constraint "notification_preferences_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES worklog.workspaces(id) ON DELETE CASCADE;
alter table worklog."push_subscriptions" add constraint "push_subscriptions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table worklog."push_subscriptions" add constraint "push_subscriptions_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES worklog.workspaces(id) ON DELETE CASCADE;
alter table worklog."schedules" add constraint "schedules_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table worklog."schedules" add constraint "schedules_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES worklog.workspaces(id) ON DELETE CASCADE;
alter table worklog."shared_cost_allocations" add constraint "shared_cost_allocations_pool_id_fkey" FOREIGN KEY (pool_id) REFERENCES worklog.shared_cost_pools(id) ON DELETE CASCADE;
alter table worklog."shared_cost_allocations" add constraint "shared_cost_allocations_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table worklog."shared_cost_allocations" add constraint "shared_cost_allocations_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES worklog.workspaces(id) ON DELETE CASCADE;
alter table worklog."source_refs" add constraint "source_refs_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table worklog."source_refs" add constraint "source_refs_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES worklog.workspaces(id) ON DELETE CASCADE;
alter table worklog."usage_events" add constraint "usage_events_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table worklog."usage_events" add constraint "usage_events_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES worklog.workspaces(id) ON DELETE CASCADE;
alter table worklog."work_record_normalizations" add constraint "work_record_normalizations_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table worklog."work_record_normalizations" add constraint "work_record_normalizations_work_record_id_fkey" FOREIGN KEY (work_record_id) REFERENCES worklog.work_records(id) ON DELETE CASCADE;
alter table worklog."work_record_normalizations" add constraint "work_record_normalizations_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES worklog.workspaces(id) ON DELETE CASCADE;
alter table worklog."work_records" add constraint "work_records_assigned_user_id_fkey" FOREIGN KEY (assigned_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table worklog."work_records" add constraint "work_records_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table worklog."work_records" add constraint "work_records_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES worklog.workspaces(id) ON DELETE CASCADE;
alter table worklog."workspace_members" add constraint "workspace_members_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table worklog."workspace_members" add constraint "workspace_members_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES worklog.workspaces(id) ON DELETE CASCADE;
alter table worklog."workspaces" add constraint "workspaces_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
alter table worklog."workspaces" add constraint "workspaces_owner_user_id_fkey" FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
CREATE OR REPLACE FUNCTION worklog_private.apply_work_record_action_journal_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION worklog_private.can_access_workspace(p_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select (select auth.uid()) is not null
    and (
      exists (
        select 1
        from worklog.workspaces w
        where w.id = p_workspace_id
          and w.owner_user_id = (select auth.uid())
      )
      or exists (
        select 1
        from worklog.workspace_members wm
        where wm.workspace_id = p_workspace_id
          and wm.user_id = (select auth.uid())
      )
    );
$function$
;
CREATE OR REPLACE FUNCTION worklog_private.enqueue_work_record_normalization()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  insert into worklog.work_record_normalizations (
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
$function$
;
CREATE OR REPLACE FUNCTION worklog_private.is_workspace_owner(p_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from worklog.workspaces w
      where w.id = p_workspace_id
        and w.owner_user_id = (select auth.uid())
    );
$function$
;
CREATE OR REPLACE FUNCTION worklog_private.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION worklog.clear_irrelevant_work_record_attention()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.status in ('completed', 'cancelled') or new.action_kind = 'note' then
    new.next_attention_at := null;
  end if;
  return new;
end;
$function$
;
CREATE TRIGGER workspaces_set_updated_at BEFORE UPDATE ON worklog.workspaces FOR EACH ROW EXECUTE FUNCTION worklog_private.set_updated_at();
CREATE TRIGGER work_records_set_updated_at BEFORE UPDATE ON worklog.work_records FOR EACH ROW EXECUTE FUNCTION worklog_private.set_updated_at();
CREATE TRIGGER schedules_set_updated_at BEFORE UPDATE ON worklog.schedules FOR EACH ROW EXECUTE FUNCTION worklog_private.set_updated_at();
CREATE TRIGGER candidates_set_updated_at BEFORE UPDATE ON worklog.candidates FOR EACH ROW EXECUTE FUNCTION worklog_private.set_updated_at();
CREATE TRIGGER shared_cost_pools_set_updated_at BEFORE UPDATE ON worklog.shared_cost_pools FOR EACH ROW EXECUTE FUNCTION worklog_private.set_updated_at();
CREATE TRIGGER work_record_normalizations_set_updated_at BEFORE UPDATE ON worklog.work_record_normalizations FOR EACH ROW EXECUTE FUNCTION worklog_private.set_updated_at();
CREATE TRIGGER work_records_enqueue_normalization AFTER INSERT ON worklog.work_records FOR EACH ROW EXECUTE FUNCTION worklog_private.enqueue_work_record_normalization();
CREATE TRIGGER work_records_apply_action_journal_state BEFORE INSERT OR UPDATE OF recorded_at, journal_date, status, briefing_state, completed_at, acknowledged_at ON worklog.work_records FOR EACH ROW EXECUTE FUNCTION worklog_private.apply_work_record_action_journal_state();
CREATE TRIGGER input_captures_set_updated_at BEFORE UPDATE ON worklog.input_captures FOR EACH ROW EXECUTE FUNCTION worklog_private.set_updated_at();
CREATE TRIGGER work_records_clear_irrelevant_attention BEFORE INSERT OR UPDATE OF status, action_kind, next_attention_at ON worklog.work_records FOR EACH ROW EXECUTE FUNCTION worklog.clear_irrelevant_work_record_attention();
alter table worklog."candidates" enable row level security;
alter table worklog."input_captures" enable row level security;
alter table worklog."notification_deliveries" enable row level security;
alter table worklog."notification_preferences" enable row level security;
alter table worklog."push_subscriptions" enable row level security;
alter table worklog."schedules" enable row level security;
alter table worklog."shared_cost_allocations" enable row level security;
alter table worklog."shared_cost_pools" enable row level security;
alter table worklog."source_refs" enable row level security;
alter table worklog."usage_events" enable row level security;
alter table worklog."work_record_normalizations" enable row level security;
alter table worklog."work_records" enable row level security;
alter table worklog."workspace_members" enable row level security;
alter table worklog."workspaces" enable row level security;
create policy "candidates_delete_member" on worklog."candidates" as PERMISSIVE for DELETE to "authenticated" using (( SELECT worklog_private.can_access_workspace(candidates.workspace_id) AS can_access_workspace));
create policy "candidates_insert_member" on worklog."candidates" as PERMISSIVE for INSERT to "authenticated" with check ((( SELECT worklog_private.can_access_workspace(candidates.workspace_id) AS can_access_workspace) AND (created_by_user_id = ( SELECT auth.uid() AS uid))));
create policy "candidates_select_member" on worklog."candidates" as PERMISSIVE for SELECT to "authenticated" using (( SELECT worklog_private.can_access_workspace(candidates.workspace_id) AS can_access_workspace));
create policy "candidates_update_member" on worklog."candidates" as PERMISSIVE for UPDATE to "authenticated" using (( SELECT worklog_private.can_access_workspace(candidates.workspace_id) AS can_access_workspace)) with check (( SELECT worklog_private.can_access_workspace(candidates.workspace_id) AS can_access_workspace));
create policy "input_captures_insert_creator" on worklog."input_captures" as PERMISSIVE for INSERT to "authenticated" with check ((( SELECT worklog_private.can_access_workspace(input_captures.workspace_id) AS can_access_workspace) AND (created_by_user_id = ( SELECT auth.uid() AS uid))));
create policy "input_captures_select_member" on worklog."input_captures" as PERMISSIVE for SELECT to "authenticated" using (( SELECT worklog_private.can_access_workspace(input_captures.workspace_id) AS can_access_workspace));
create policy "input_captures_update_creator" on worklog."input_captures" as PERMISSIVE for UPDATE to "authenticated" using ((( SELECT worklog_private.can_access_workspace(input_captures.workspace_id) AS can_access_workspace) AND (created_by_user_id = ( SELECT auth.uid() AS uid)))) with check ((( SELECT worklog_private.can_access_workspace(input_captures.workspace_id) AS can_access_workspace) AND (created_by_user_id = ( SELECT auth.uid() AS uid))));
create policy "notification_deliveries_select_own" on worklog."notification_deliveries" as PERMISSIVE for SELECT to "authenticated" using ((user_id = auth.uid()));
create policy "notification_preferences_insert_own" on worklog."notification_preferences" as PERMISSIVE for INSERT to "authenticated" with check (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM worklog.workspace_members wm
  WHERE ((wm.workspace_id = notification_preferences.workspace_id) AND (wm.user_id = auth.uid()))))));
create policy "notification_preferences_select_own" on worklog."notification_preferences" as PERMISSIVE for SELECT to "authenticated" using (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM worklog.workspace_members wm
  WHERE ((wm.workspace_id = notification_preferences.workspace_id) AND (wm.user_id = auth.uid()))))));
create policy "notification_preferences_update_own" on worklog."notification_preferences" as PERMISSIVE for UPDATE to "authenticated" using ((user_id = auth.uid())) with check (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM worklog.workspace_members wm
  WHERE ((wm.workspace_id = notification_preferences.workspace_id) AND (wm.user_id = auth.uid()))))));
create policy "push_subscriptions_delete_own" on worklog."push_subscriptions" as PERMISSIVE for DELETE to "public" using (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT worklog_private.can_access_workspace(push_subscriptions.workspace_id) AS can_access_workspace)));
create policy "push_subscriptions_insert_own" on worklog."push_subscriptions" as PERMISSIVE for INSERT to "public" with check (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT worklog_private.can_access_workspace(push_subscriptions.workspace_id) AS can_access_workspace)));
create policy "push_subscriptions_select_own" on worklog."push_subscriptions" as PERMISSIVE for SELECT to "public" using (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT worklog_private.can_access_workspace(push_subscriptions.workspace_id) AS can_access_workspace)));
create policy "push_subscriptions_update_own" on worklog."push_subscriptions" as PERMISSIVE for UPDATE to "public" using (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT worklog_private.can_access_workspace(push_subscriptions.workspace_id) AS can_access_workspace))) with check (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT worklog_private.can_access_workspace(push_subscriptions.workspace_id) AS can_access_workspace)));
create policy "schedules_insert_member" on worklog."schedules" as PERMISSIVE for INSERT to "authenticated" with check ((( SELECT worklog_private.can_access_workspace(schedules.workspace_id) AS can_access_workspace) AND (created_by_user_id = ( SELECT auth.uid() AS uid))));
create policy "schedules_select_member" on worklog."schedules" as PERMISSIVE for SELECT to "authenticated" using (( SELECT worklog_private.can_access_workspace(schedules.workspace_id) AS can_access_workspace));
create policy "schedules_update_creator" on worklog."schedules" as PERMISSIVE for UPDATE to "authenticated" using ((( SELECT worklog_private.can_access_workspace(schedules.workspace_id) AS can_access_workspace) AND (created_by_user_id = ( SELECT auth.uid() AS uid)))) with check ((( SELECT worklog_private.can_access_workspace(schedules.workspace_id) AS can_access_workspace) AND (created_by_user_id = ( SELECT auth.uid() AS uid))));
create policy "shared_cost_allocations_select_own" on worklog."shared_cost_allocations" as PERMISSIVE for SELECT to "authenticated" using (((user_id = ( SELECT auth.uid() AS uid)) AND worklog_private.can_access_workspace(workspace_id)));
create policy "shared_cost_pools_deny_authenticated_select" on worklog."shared_cost_pools" as PERMISSIVE for SELECT to "authenticated" using (false);
create policy "source_refs_delete_member" on worklog."source_refs" as PERMISSIVE for DELETE to "authenticated" using (( SELECT worklog_private.can_access_workspace(source_refs.workspace_id) AS can_access_workspace));
create policy "source_refs_insert_member" on worklog."source_refs" as PERMISSIVE for INSERT to "authenticated" with check ((( SELECT worklog_private.can_access_workspace(source_refs.workspace_id) AS can_access_workspace) AND (created_by_user_id = ( SELECT auth.uid() AS uid))));
create policy "source_refs_select_member" on worklog."source_refs" as PERMISSIVE for SELECT to "authenticated" using (( SELECT worklog_private.can_access_workspace(source_refs.workspace_id) AS can_access_workspace));
create policy "source_refs_update_member" on worklog."source_refs" as PERMISSIVE for UPDATE to "authenticated" using (( SELECT worklog_private.can_access_workspace(source_refs.workspace_id) AS can_access_workspace)) with check (( SELECT worklog_private.can_access_workspace(source_refs.workspace_id) AS can_access_workspace));
create policy "usage_events_select_own" on worklog."usage_events" as PERMISSIVE for SELECT to "authenticated" using (((user_id = ( SELECT auth.uid() AS uid)) AND worklog_private.can_access_workspace(workspace_id)));
create policy "work_record_normalizations_insert_creator" on worklog."work_record_normalizations" as PERMISSIVE for INSERT to "authenticated" with check ((( SELECT worklog_private.can_access_workspace(work_record_normalizations.workspace_id) AS can_access_workspace) AND (created_by_user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM worklog.work_records wr
  WHERE ((wr.id = work_record_normalizations.work_record_id) AND (wr.workspace_id = wr.workspace_id) AND (wr.created_by_user_id = ( SELECT auth.uid() AS uid)))))));
create policy "work_record_normalizations_select_member" on worklog."work_record_normalizations" as PERMISSIVE for SELECT to "authenticated" using (( SELECT worklog_private.can_access_workspace(work_record_normalizations.workspace_id) AS can_access_workspace));
create policy "work_record_normalizations_update_creator" on worklog."work_record_normalizations" as PERMISSIVE for UPDATE to "authenticated" using ((( SELECT worklog_private.can_access_workspace(work_record_normalizations.workspace_id) AS can_access_workspace) AND (created_by_user_id = ( SELECT auth.uid() AS uid)))) with check ((( SELECT worklog_private.can_access_workspace(work_record_normalizations.workspace_id) AS can_access_workspace) AND (created_by_user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM worklog.work_records wr
  WHERE ((wr.id = work_record_normalizations.work_record_id) AND (wr.workspace_id = wr.workspace_id) AND (wr.created_by_user_id = ( SELECT auth.uid() AS uid)))))));
create policy "work_records_insert_member" on worklog."work_records" as PERMISSIVE for INSERT to "authenticated" with check ((( SELECT worklog_private.can_access_workspace(work_records.workspace_id) AS can_access_workspace) AND (created_by_user_id = ( SELECT auth.uid() AS uid))));
create policy "work_records_select_member" on worklog."work_records" as PERMISSIVE for SELECT to "authenticated" using (( SELECT worklog_private.can_access_workspace(work_records.workspace_id) AS can_access_workspace));
create policy "work_records_update_creator" on worklog."work_records" as PERMISSIVE for UPDATE to "authenticated" using ((( SELECT worklog_private.can_access_workspace(work_records.workspace_id) AS can_access_workspace) AND (created_by_user_id = ( SELECT auth.uid() AS uid)))) with check ((( SELECT worklog_private.can_access_workspace(work_records.workspace_id) AS can_access_workspace) AND (created_by_user_id = ( SELECT auth.uid() AS uid))));
create policy "workspace_members_delete_owner" on worklog."workspace_members" as PERMISSIVE for DELETE to "authenticated" using (( SELECT worklog_private.is_workspace_owner(workspace_members.workspace_id) AS is_workspace_owner));
create policy "workspace_members_insert_owner" on worklog."workspace_members" as PERMISSIVE for INSERT to "authenticated" with check ((( SELECT worklog_private.is_workspace_owner(workspace_members.workspace_id) AS is_workspace_owner) AND ((role = 'member'::text) OR (user_id = ( SELECT auth.uid() AS uid)))));
create policy "workspace_members_select_member" on worklog."workspace_members" as PERMISSIVE for SELECT to "authenticated" using (( SELECT worklog_private.can_access_workspace(workspace_members.workspace_id) AS can_access_workspace));
create policy "workspace_members_update_owner" on worklog."workspace_members" as PERMISSIVE for UPDATE to "authenticated" using (( SELECT worklog_private.is_workspace_owner(workspace_members.workspace_id) AS is_workspace_owner)) with check ((( SELECT worklog_private.is_workspace_owner(workspace_members.workspace_id) AS is_workspace_owner) AND ((role = 'member'::text) OR (user_id = ( SELECT auth.uid() AS uid)))));
create policy "workspaces_delete_owner" on worklog."workspaces" as PERMISSIVE for DELETE to "authenticated" using (( SELECT worklog_private.is_workspace_owner(workspaces.id) AS is_workspace_owner));
create policy "workspaces_insert_owner" on worklog."workspaces" as PERMISSIVE for INSERT to "authenticated" with check (((owner_user_id = ( SELECT auth.uid() AS uid)) AND (created_by_user_id = ( SELECT auth.uid() AS uid))));
create policy "workspaces_select_member" on worklog."workspaces" as PERMISSIVE for SELECT to "authenticated" using (( SELECT worklog_private.can_access_workspace(workspaces.id) AS can_access_workspace));
create policy "workspaces_update_owner" on worklog."workspaces" as PERMISSIVE for UPDATE to "authenticated" using (( SELECT worklog_private.is_workspace_owner(workspaces.id) AS is_workspace_owner)) with check ((owner_user_id = ( SELECT auth.uid() AS uid)));
revoke execute on all functions in schema worklog_private from public,anon,authenticated;
grant execute on function worklog_private.can_access_workspace(uuid),worklog_private.is_workspace_owner(uuid) to authenticated;
grant select on all tables in schema worklog to authenticated;
CREATE INDEX candidates_workspace_status_type_idx ON worklog.candidates USING btree (workspace_id, status, candidate_type, created_at DESC);
CREATE INDEX candidates_created_by_user_id_idx ON worklog.candidates USING btree (created_by_user_id);
CREATE INDEX candidates_source_ref_id_idx ON worklog.candidates USING btree (source_ref_id);
CREATE INDEX input_captures_workspace_recorded_at_idx ON worklog.input_captures USING btree (workspace_id, recorded_at DESC);
CREATE INDEX input_captures_created_by_user_id_idx ON worklog.input_captures USING btree (created_by_user_id) WHERE (created_by_user_id IS NOT NULL);
CREATE INDEX notification_deliveries_user_date_idx ON worklog.notification_deliveries USING btree (user_id, local_date DESC, created_at DESC);
CREATE INDEX push_subscriptions_active_origin_idx ON worklog.push_subscriptions USING btree (app_origin, workspace_id, user_id) WHERE (disabled_at IS NULL);
CREATE INDEX push_subscriptions_workspace_user_idx ON worklog.push_subscriptions USING btree (workspace_id, user_id) WHERE (disabled_at IS NULL);
CREATE INDEX schedules_created_by_user_id_idx ON worklog.schedules USING btree (created_by_user_id);
CREATE INDEX schedules_workspace_status_starts_at_idx ON worklog.schedules USING btree (workspace_id, status, starts_at);
CREATE INDEX schedules_workspace_starts_at_idx ON worklog.schedules USING btree (workspace_id, starts_at);
CREATE INDEX shared_cost_allocations_workspace_month_idx ON worklog.shared_cost_allocations USING btree (workspace_id, month_start DESC);
CREATE INDEX shared_cost_allocations_user_month_idx ON worklog.shared_cost_allocations USING btree (user_id, month_start DESC);
CREATE INDEX source_refs_entity_idx ON worklog.source_refs USING btree (workspace_id, entity_type, entity_id);
CREATE INDEX source_refs_created_by_user_id_idx ON worklog.source_refs USING btree (created_by_user_id);
CREATE INDEX source_refs_source_idx ON worklog.source_refs USING btree (workspace_id, source_type, source_id) WHERE (source_id IS NOT NULL);
CREATE INDEX usage_events_workspace_created_at_idx ON worklog.usage_events USING btree (workspace_id, created_at DESC);
CREATE INDEX usage_events_feature_service_created_at_idx ON worklog.usage_events USING btree (feature, service, created_at DESC);
CREATE UNIQUE INDEX usage_events_workspace_event_key_uidx ON worklog.usage_events USING btree (workspace_id, event_key);
CREATE INDEX usage_events_user_created_at_idx ON worklog.usage_events USING btree (user_id, created_at DESC);
CREATE INDEX work_record_normalizations_search_aliases_idx ON worklog.work_record_normalizations USING gin (search_aliases);
CREATE INDEX work_record_normalizations_search_text_trgm_idx ON worklog.work_record_normalizations USING gin ((((((((((((((((((COALESCE(normalized_title, ''::text) || ' '::text) || COALESCE(normalized_text, ''::text)) || ' '::text) || COALESCE((structured_data ->> 'institution'::text), ''::text)) || ' '::text) || COALESCE((structured_data ->> 'project'::text), ''::text)) || ' '::text) || COALESCE((structured_data ->> 'project_name'::text), ''::text)) || ' '::text) || COALESCE((structured_data ->> 'person'::text), ''::text)) || ' '::text) || COALESCE((structured_data ->> 'people'::text), ''::text)) || ' '::text) || COALESCE((structured_data ->> 'contact'::text), ''::text)) || ' '::text) || COALESCE((structured_data ->> 'keywords'::text), ''::text))) gin_trgm_ops);
CREATE INDEX work_record_normalizations_workspace_status_retry_idx ON worklog.work_record_normalizations USING btree (workspace_id, processing_status, next_retry_at);
CREATE INDEX work_records_open_workspace_updated_at_idx ON worklog.work_records USING btree (workspace_id, updated_at DESC) WHERE (status = ANY (ARRAY['in_progress'::text, 'waiting'::text, 'needs_review'::text]));
CREATE INDEX work_records_assigned_user_id_idx ON worklog.work_records USING btree (assigned_user_id);
CREATE INDEX work_records_workspace_due_at_idx ON worklog.work_records USING btree (workspace_id, due_at) WHERE (due_at IS NOT NULL);
CREATE INDEX work_records_workspace_active_notes_idx ON worklog.work_records USING btree (workspace_id, journal_date DESC, recorded_at DESC) WHERE ((action_kind = 'note'::text) AND (briefing_state = 'active'::text));
CREATE INDEX work_records_workspace_next_attention_at_idx ON worklog.work_records USING btree (workspace_id, next_attention_at) WHERE ((next_attention_at IS NOT NULL) AND (action_kind = 'task'::text) AND (status = ANY (ARRAY['in_progress'::text, 'waiting'::text, 'needs_review'::text])));
CREATE INDEX work_records_workspace_journal_date_idx ON worklog.work_records USING btree (workspace_id, journal_date DESC, recorded_at DESC);
CREATE INDEX work_records_workspace_recorded_at_idx ON worklog.work_records USING btree (workspace_id, recorded_at DESC);
CREATE INDEX work_records_created_by_user_id_idx ON worklog.work_records USING btree (created_by_user_id);
CREATE INDEX work_records_search_text_trgm_idx ON worklog.work_records USING gin ((((((((((COALESCE(title, ''::text) || ' '::text) || COALESCE(content, ''::text)) || ' '::text) || COALESCE(original_text, ''::text)) || ' '::text) || COALESCE(institution, ''::text)) || ' '::text) || COALESCE(follow_up, ''::text))) gin_trgm_ops);
CREATE INDEX workspace_members_user_id_idx ON worklog.workspace_members USING btree (user_id);
CREATE INDEX workspaces_created_by_user_id_idx ON worklog.workspaces USING btree (created_by_user_id);
CREATE UNIQUE INDEX workspaces_one_personal_per_owner_idx ON worklog.workspaces USING btree (owner_user_id) WHERE (kind = 'personal'::text);
CREATE INDEX workspaces_owner_user_id_idx ON worklog.workspaces USING btree (owner_user_id);

