create or replace function public.get_my_work_record_edit(p_record_id uuid)
returns table(
  record_id uuid,
  title_value text,
  due_at_value timestamptz,
  due_has_time boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED';
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

  return query
  select
    wr.id,
    wr.title,
    wr.due_at,
    case
      when wr.due_at is null then false
      when coalesce(wr.metadata ->> 'dueTimeExplicit', '') in ('true','false')
        then (wr.metadata ->> 'dueTimeExplicit')::boolean
      else ((wr.due_at at time zone 'Asia/Seoul')::time <> time '00:00')
    end
  from public.work_records wr
  where wr.id = p_record_id
    and wr.workspace_id = v_workspace_id
    and wr.created_by_user_id = v_user_id;

  if not found then
    raise exception 'WORK_RECORD_NOT_FOUND_OR_FORBIDDEN';
  end if;
end;
$$;

create or replace function public.update_my_work_record_details(
  p_record_id uuid,
  p_title text,
  p_due_at timestamptz,
  p_due_has_time boolean default false
)
returns table(
  record_id uuid,
  title_value text,
  due_at_value timestamptz,
  due_has_time boolean,
  schedule_updated boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
  v_title text := btrim(coalesce(p_title, ''));
  v_due_has_time boolean := case when p_due_at is null then false else coalesce(p_due_has_time, false) end;
  v_record_id uuid;
  v_title_value text;
  v_due_at_value timestamptz;
  v_schedule_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  if char_length(v_title) < 1 or char_length(v_title) > 160 then
    raise exception 'WORK_RECORD_TITLE_INVALID';
  end if;

  if p_due_at is null and coalesce(p_due_has_time, false) then
    raise exception 'WORK_RECORD_DUE_INVALID';
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

  update public.work_records wr
  set title = v_title,
      due_at = p_due_at,
      metadata = coalesce(wr.metadata, '{}'::jsonb) || jsonb_build_object('dueTimeExplicit', v_due_has_time),
      updated_at = now()
  where wr.id = p_record_id
    and wr.workspace_id = v_workspace_id
    and wr.created_by_user_id = v_user_id
  returning wr.id, wr.title, wr.due_at
  into v_record_id, v_title_value, v_due_at_value;

  if v_record_id is null then
    raise exception 'WORK_RECORD_NOT_FOUND_OR_FORBIDDEN';
  end if;

  update public.schedules s
  set title = v_title,
      starts_at = case when p_due_at is null then s.starts_at else p_due_at end,
      all_day = case when p_due_at is null then s.all_day else not v_due_has_time end,
      timezone = case when p_due_at is null then s.timezone else 'Asia/Seoul' end,
      status = case
        when p_due_at is null then 'cancelled'
        when s.status = 'cancelled' then s.status
        else 'confirmed'
      end,
      updated_at = now()
  where s.workspace_id = v_workspace_id
    and s.created_by_user_id = v_user_id
    and s.metadata ->> 'workRecordId' = p_record_id::text;

  get diagnostics v_schedule_count = row_count;

  return query
  select v_record_id, v_title_value, v_due_at_value, v_due_has_time, (v_schedule_count > 0);
end;
$$;

revoke all on function public.get_my_work_record_edit(uuid) from public;
revoke all on function public.get_my_work_record_edit(uuid) from anon;
grant execute on function public.get_my_work_record_edit(uuid) to authenticated;
grant execute on function public.get_my_work_record_edit(uuid) to service_role;

revoke all on function public.update_my_work_record_details(uuid,text,timestamptz,boolean) from public;
revoke all on function public.update_my_work_record_details(uuid,text,timestamptz,boolean) from anon;
grant execute on function public.update_my_work_record_details(uuid,text,timestamptz,boolean) to authenticated;
grant execute on function public.update_my_work_record_details(uuid,text,timestamptz,boolean) to service_role;
