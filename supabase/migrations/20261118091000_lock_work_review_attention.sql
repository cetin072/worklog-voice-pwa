-- Compare and clear/restore the displayed review date under the same row lock.
create or replace function worklog.undo_my_work_record_attention(
  p_record_id uuid,
  p_expected_attention_at timestamptz default null,
  p_previous_attention_at timestamptz default null
)
returns table(record_id uuid, next_attention_at_value timestamptz)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
  v_current_attention_at timestamptz;
  v_record_id uuid;
  v_next_attention_at timestamptz;
begin
  if v_user_id is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;

  select w.id into v_workspace_id
  from worklog.workspaces w
  where w.owner_user_id = v_user_id and w.kind = 'personal'
  order by w.created_at asc limit 1;
  if v_workspace_id is null then raise exception 'PERSONAL_WORKSPACE_MISSING'; end if;

  select wr.next_attention_at
  into v_current_attention_at
  from worklog.work_records wr
  where wr.id = p_record_id
    and wr.workspace_id = v_workspace_id
    and wr.created_by_user_id = v_user_id
    and wr.status in ('in_progress', 'waiting', 'needs_review')
    and wr.action_kind is distinct from 'note'
  for update;
  if not found then raise exception 'WORK_RECORD_NOT_FOUND_OR_FORBIDDEN'; end if;

  if v_current_attention_at is distinct from p_expected_attention_at then
    raise exception 'WORK_RECORD_ATTENTION_UNDO_STALE';
  end if;

  update worklog.work_records wr
  set next_attention_at = p_previous_attention_at,
      updated_at = now()
  where wr.id = p_record_id
    and wr.workspace_id = v_workspace_id
    and wr.created_by_user_id = v_user_id
  returning wr.id, wr.next_attention_at into v_record_id, v_next_attention_at;

  return query select v_record_id, v_next_attention_at;
end;
$function$;

revoke all on function worklog.undo_my_work_record_attention(uuid,timestamptz,timestamptz) from public, anon;
grant execute on function worklog.undo_my_work_record_attention(uuid,timestamptz,timestamptz) to authenticated;
