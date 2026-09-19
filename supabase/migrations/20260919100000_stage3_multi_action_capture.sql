-- Issue #374 / Stage 3-4: shared input capture + atomic multi-action save.
-- One original input is stored once, then bounded child Actions reference it.

create table public.input_captures (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by_user_id uuid references auth.users(id) on delete set null,
  client_request_id text not null check (char_length(btrim(client_request_id)) between 16 and 100),
  source_type text not null default 'direct' check (
    source_type in ('direct', 'voice', 'call', 'meeting', 'mail', 'capture', 'scan', 'notion', 'import', 'other')
  ),
  original_text text not null default '' check (char_length(original_text) <= 10000),
  recorded_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, client_request_id)
);

create index input_captures_workspace_recorded_at_idx
  on public.input_captures(workspace_id, recorded_at desc);

create trigger input_captures_set_updated_at
before update on public.input_captures
for each row execute function private.set_updated_at();

alter table public.input_captures enable row level security;

revoke all on table public.input_captures from anon;
grant select, insert, update on table public.input_captures to authenticated;
grant select, insert, update, delete on table public.input_captures to service_role;

create policy input_captures_select_member
on public.input_captures for select
to authenticated
using ((select private.can_access_workspace(workspace_id)));

create policy input_captures_insert_creator
on public.input_captures for insert
to authenticated
with check (
  (select private.can_access_workspace(workspace_id))
  and created_by_user_id = (select auth.uid())
);

create policy input_captures_update_creator
on public.input_captures for update
to authenticated
using (
  (select private.can_access_workspace(workspace_id))
  and created_by_user_id = (select auth.uid())
)
with check (
  (select private.can_access_workspace(workspace_id))
  and created_by_user_id = (select auth.uid())
);

create or replace function public.save_my_multi_action_worklog(
  p_parent_request_id text,
  p_original_text text,
  p_source_type text default 'direct',
  p_recorded_at timestamptz default now(),
  p_capture_metadata jsonb default '{}'::jsonb,
  p_items jsonb default '[]'::jsonb
)
returns table (
  capture_id uuid,
  saved_count integer,
  work_record_ids uuid[],
  source_ref_ids uuid[],
  schedule_ids uuid[]
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
  v_parent_request_id text := btrim(coalesce(p_parent_request_id, ''));
  v_source_type text := lower(btrim(coalesce(p_source_type, 'direct')));
  v_capture_id uuid;
  v_existing_original text;
  v_existing_source_type text;
  v_item jsonb;
  v_index bigint;
  v_count integer;
  v_child_request_id text;
  v_user_result uuid;
  v_workspace_result uuid;
  v_work_record_id uuid;
  v_source_ref_id uuid;
  v_schedule_id uuid;
  v_work_ids uuid[] := '{}'::uuid[];
  v_source_ids uuid[] := '{}'::uuid[];
  v_schedule_ids uuid[] := '{}'::uuid[];
  v_metadata jsonb;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  if char_length(v_parent_request_id) < 16 or char_length(v_parent_request_id) > 100
     or v_parent_request_id !~ '^[A-Za-z0-9-]+$' then
    raise exception 'MULTI_ACTION_PARENT_REQUEST_ID_INVALID';
  end if;

  if v_source_type not in ('direct', 'voice', 'call', 'meeting', 'mail', 'capture', 'scan', 'notion', 'import', 'other') then
    raise exception 'MULTI_ACTION_SOURCE_TYPE_INVALID';
  end if;

  if char_length(coalesce(p_original_text, '')) > 10000 then
    raise exception 'MULTI_ACTION_ORIGINAL_TOO_LONG';
  end if;

  if jsonb_typeof(coalesce(p_capture_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'MULTI_ACTION_CAPTURE_METADATA_INVALID';
  end if;

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'MULTI_ACTION_ITEMS_INVALID';
  end if;

  v_count := jsonb_array_length(p_items);
  if v_count < 2 or v_count > 8 then
    raise exception 'MULTI_ACTION_ITEM_COUNT_INVALID';
  end if;

  select w.id into v_workspace_id
  from public.workspaces w
  where w.owner_user_id = v_user_id
    and w.kind = 'personal'
  order by w.created_at asc
  limit 1;

  if v_workspace_id is null then
    raise exception 'PERSONAL_WORKSPACE_MISSING';
  end if;

  select c.id, c.original_text, c.source_type
  into v_capture_id, v_existing_original, v_existing_source_type
  from public.input_captures c
  where c.workspace_id = v_workspace_id
    and c.client_request_id = v_parent_request_id
  limit 1;

  if v_capture_id is not null then
    if v_existing_original is distinct from coalesce(p_original_text, '')
       or v_existing_source_type is distinct from v_source_type then
      raise exception 'MULTI_ACTION_CAPTURE_REQUEST_CONFLICT';
    end if;

    update public.input_captures c
    set metadata = coalesce(c.metadata, '{}'::jsonb)
          || coalesce(p_capture_metadata, '{}'::jsonb)
          || jsonb_build_object('segmentCount', v_count)
    where c.id = v_capture_id;
  else
    insert into public.input_captures (
      workspace_id,
      created_by_user_id,
      client_request_id,
      source_type,
      original_text,
      recorded_at,
      metadata
    ) values (
      v_workspace_id,
      v_user_id,
      v_parent_request_id,
      v_source_type,
      coalesce(p_original_text, ''),
      p_recorded_at,
      coalesce(p_capture_metadata, '{}'::jsonb)
        || jsonb_build_object('segmentCount', v_count)
    )
    returning id into v_capture_id;
  end if;

  for v_item, v_index in
    select value, ordinality
    from jsonb_array_elements(p_items) with ordinality
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'MULTI_ACTION_ITEM_INVALID';
    end if;

    v_child_request_id := 'multi-' || substr(md5(v_parent_request_id), 1, 24) || '-' || lpad(v_index::text, 2, '0');

    v_metadata := coalesce(v_item -> 'metadata', '{}'::jsonb)
      || jsonb_build_object(
        'inputCapture',
        jsonb_build_object(
          'captureId', v_capture_id,
          'requestId', v_parent_request_id,
          'segmentIndex', v_index,
          'segmentCount', v_count,
          'sourceType', v_source_type
        )
      );

    select r.user_id, r.workspace_id, r.work_record_id, r.source_ref_id, r.schedule_id
    into v_user_result, v_workspace_result, v_work_record_id, v_source_ref_id, v_schedule_id
    from public.save_my_worklog_with_schedule(
      v_child_request_id,
      nullif(btrim(coalesce(v_item ->> 'title', '')), ''),
      coalesce(v_item ->> 'content', ''),
      coalesce(v_item ->> 'originalText', ''),
      coalesce(v_item ->> 'recordType', 'other'),
      coalesce(v_item ->> 'status', 'in_progress'),
      nullif(btrim(coalesce(v_item ->> 'institution', '')), ''),
      case
        when nullif(btrim(coalesce(v_item ->> 'amount', '')), '') is null then null
        else (v_item ->> 'amount')::numeric
      end,
      nullif(btrim(coalesce(v_item ->> 'followUp', '')), ''),
      coalesce(nullif(v_item ->> 'recordedAt', '')::timestamptz, p_recorded_at),
      nullif(v_item ->> 'dueAt', '')::timestamptz,
      v_metadata,
      coalesce(v_item ->> 'sourceExcerpt', v_item ->> 'originalText', ''),
      nullif(btrim(coalesce(v_item ->> 'scheduleTitle', '')), ''),
      nullif(v_item ->> 'scheduleStartsAt', '')::timestamptz
    ) r;

    if v_user_result is distinct from v_user_id
       or v_workspace_result is distinct from v_workspace_id
       or v_work_record_id is null
       or v_source_ref_id is null then
      raise exception 'MULTI_ACTION_CHILD_SAVE_INVALID';
    end if;

    update public.source_refs sr
    set source_type = v_source_type,
        source_id = v_parent_request_id,
        source_excerpt = coalesce(v_item ->> 'sourceExcerpt', v_item ->> 'originalText', ''),
        metadata = coalesce(sr.metadata, '{}'::jsonb)
          || jsonb_build_object(
            'inputCapture',
            jsonb_build_object(
              'captureId', v_capture_id,
              'requestId', v_parent_request_id,
              'segmentIndex', v_index,
              'segmentCount', v_count,
              'sourceType', v_source_type
            )
          )
    where sr.id = v_source_ref_id
      and sr.workspace_id = v_workspace_id
      and sr.created_by_user_id = v_user_id;

    if not found then
      raise exception 'MULTI_ACTION_SOURCE_REF_LINK_FAILED';
    end if;

    v_work_ids := array_append(v_work_ids, v_work_record_id);
    v_source_ids := array_append(v_source_ids, v_source_ref_id);
    if v_schedule_id is not null then
      v_schedule_ids := array_append(v_schedule_ids, v_schedule_id);
    end if;
  end loop;

  return query
  select v_capture_id, v_count, v_work_ids, v_source_ids, v_schedule_ids;
end;
$$;

revoke all on function public.save_my_multi_action_worklog(text, text, text, timestamptz, jsonb, jsonb) from public, anon;
grant execute on function public.save_my_multi_action_worklog(text, text, text, timestamptz, jsonb, jsonb)
to authenticated, service_role;
