-- Issue #217: save Quick Worklog Data Core rows in one authenticated RPC.
-- Classification/normalization stays in application code; RLS remains authoritative.

create or replace function public.save_my_worklog(
  p_client_request_id text,
  p_title text,
  p_content text,
  p_original_text text,
  p_record_type text,
  p_status text,
  p_institution text default null,
  p_amount numeric default null,
  p_follow_up text default null,
  p_recorded_at timestamptz default now(),
  p_due_at timestamptz default null,
  p_metadata jsonb default '{}'::jsonb,
  p_source_excerpt text default null
)
returns table (
  user_id uuid,
  workspace_id uuid,
  work_record_id uuid,
  source_ref_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
  v_work_record_id uuid;
  v_source_ref_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  if p_client_request_id is null
    or char_length(btrim(p_client_request_id)) < 16
    or char_length(btrim(p_client_request_id)) > 100 then
    raise exception 'CLIENT_REQUEST_ID_INVALID';
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

  insert into public.work_records (
    workspace_id,
    created_by_user_id,
    client_request_id,
    title,
    content,
    original_text,
    record_type,
    status,
    institution,
    amount,
    follow_up,
    recorded_at,
    due_at,
    metadata
  ) values (
    v_workspace_id,
    v_user_id,
    btrim(p_client_request_id),
    p_title,
    coalesce(p_content, ''),
    coalesce(p_original_text, ''),
    p_record_type,
    p_status,
    nullif(btrim(coalesce(p_institution, '')), ''),
    p_amount,
    nullif(btrim(coalesce(p_follow_up, '')), ''),
    p_recorded_at,
    p_due_at,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict on constraint work_records_workspace_client_request_id_key
  do update set
    title = excluded.title,
    content = excluded.content,
    original_text = excluded.original_text,
    record_type = excluded.record_type,
    status = excluded.status,
    institution = excluded.institution,
    amount = excluded.amount,
    follow_up = excluded.follow_up,
    recorded_at = excluded.recorded_at,
    due_at = excluded.due_at,
    metadata = excluded.metadata
  returning id into v_work_record_id;

  insert into public.source_refs (
    workspace_id,
    created_by_user_id,
    client_request_id,
    entity_type,
    entity_id,
    source_type,
    source_id,
    source_excerpt,
    metadata
  ) values (
    v_workspace_id,
    v_user_id,
    btrim(p_client_request_id),
    'work_record',
    v_work_record_id::text,
    'direct',
    btrim(p_client_request_id),
    p_source_excerpt,
    jsonb_build_object('source', 'quick_worklog')
  )
  on conflict on constraint source_refs_workspace_client_request_id_key
  do update set
    entity_type = excluded.entity_type,
    entity_id = excluded.entity_id,
    source_type = excluded.source_type,
    source_id = excluded.source_id,
    source_excerpt = excluded.source_excerpt,
    metadata = excluded.metadata
  returning id into v_source_ref_id;

  return query
  select v_user_id, v_workspace_id, v_work_record_id, v_source_ref_id;
end;
$$;

revoke all on function public.save_my_worklog(text, text, text, text, text, text, text, numeric, text, timestamptz, timestamptz, jsonb, text) from public, anon;
grant execute on function public.save_my_worklog(text, text, text, text, text, text, text, numeric, text, timestamptz, timestamptz, jsonb, text) to authenticated, service_role;
