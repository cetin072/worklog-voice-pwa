-- Issue #343: Insurance Pack 0.1-A1 customer-linked case and Core next action.
-- Customer names and phone numbers remain outside this domain. Cases store only customer_key.

create table public.insurance_cases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  client_request_id text not null check (char_length(client_request_id) between 16 and 100),
  customer_key text not null check (customer_key ~ '^P-([A-F0-9]{12}|DEV-[A-Z0-9]{4,32})$'),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  status text not null default 'intake' check (status in ('intake', 'checking', 'waiting', 'active', 'closed')),
  waiting_party text check (waiting_party is null or waiting_party in ('customer', 'insurer', 'internal', 'external')),
  waiting_reason text check (waiting_reason is null or char_length(waiting_reason) between 1 and 1000),
  original_work_record_id uuid not null references public.work_records(id) on delete restrict,
  current_action_work_record_id uuid references public.work_records(id) on delete set null,
  revision integer not null default 1 check (revision >= 1),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, client_request_id),
  check ((status = 'closed' and closed_at is not null) or (status <> 'closed' and closed_at is null))
);

create table public.insurance_case_work_records (
  insurance_case_id uuid not null references public.insurance_cases(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  work_record_id uuid not null references public.work_records(id) on delete restrict,
  role text not null check (role in ('original', 'action')),
  linked_by_user_id uuid not null references auth.users(id) on delete restrict,
  linked_at timestamptz not null default now(),
  primary key (insurance_case_id, work_record_id)
);

create index insurance_cases_workspace_updated_idx
on public.insurance_cases(workspace_id, updated_at desc);

create index insurance_cases_workspace_customer_idx
on public.insurance_cases(workspace_id, customer_key, updated_at desc);

create index insurance_case_work_records_record_idx
on public.insurance_case_work_records(workspace_id, work_record_id);

create trigger insurance_cases_set_updated_at
before update on public.insurance_cases
for each row execute function private.set_updated_at();

create or replace function private.validate_insurance_case_workspaces()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.work_records wr
    where wr.id = new.original_work_record_id
      and wr.workspace_id = new.workspace_id
  ) then
    raise exception 'INSURANCE_CASE_ORIGINAL_WORKSPACE_MISMATCH' using errcode = '23514';
  end if;

  if new.current_action_work_record_id is not null and not exists (
    select 1 from public.work_records wr
    where wr.id = new.current_action_work_record_id
      and wr.workspace_id = new.workspace_id
  ) then
    raise exception 'INSURANCE_CASE_ACTION_WORKSPACE_MISMATCH' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function private.validate_insurance_case_link_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.insurance_cases ic
    where ic.id = new.insurance_case_id
      and ic.workspace_id = new.workspace_id
  ) or not exists (
    select 1 from public.work_records wr
    where wr.id = new.work_record_id
      and wr.workspace_id = new.workspace_id
  ) then
    raise exception 'INSURANCE_CASE_LINK_WORKSPACE_MISMATCH' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.validate_insurance_case_workspaces() from public, anon, authenticated;
revoke all on function private.validate_insurance_case_link_workspace() from public, anon, authenticated;

create trigger insurance_cases_validate_workspaces
before insert or update of workspace_id, original_work_record_id, current_action_work_record_id
on public.insurance_cases
for each row execute function private.validate_insurance_case_workspaces();

create trigger insurance_case_links_validate_workspace
before insert or update of workspace_id, insurance_case_id, work_record_id
on public.insurance_case_work_records
for each row execute function private.validate_insurance_case_link_workspace();

alter table public.insurance_cases enable row level security;
alter table public.insurance_case_work_records enable row level security;

revoke all on table public.insurance_cases from anon;
revoke all on table public.insurance_case_work_records from anon;
grant select, insert, update, delete on table public.insurance_cases to authenticated, service_role;
grant select, insert, update, delete on table public.insurance_case_work_records to authenticated, service_role;

create policy insurance_cases_select_member
on public.insurance_cases for select to authenticated
using ((select private.can_access_workspace(workspace_id)));

create policy insurance_cases_insert_creator
on public.insurance_cases for insert to authenticated
with check (
  (select private.can_access_workspace(workspace_id))
  and created_by_user_id = (select auth.uid())
  and exists (
    select 1 from public.work_records wr
    where wr.id = original_work_record_id
      and wr.workspace_id = workspace_id
      and wr.created_by_user_id = (select auth.uid())
  )
);

create policy insurance_cases_update_creator
on public.insurance_cases for update to authenticated
using (
  (select private.can_access_workspace(workspace_id))
  and created_by_user_id = (select auth.uid())
)
with check (
  (select private.can_access_workspace(workspace_id))
  and created_by_user_id = (select auth.uid())
  and exists (
    select 1 from public.work_records wr
    where wr.id = original_work_record_id
      and wr.workspace_id = workspace_id
      and wr.created_by_user_id = (select auth.uid())
  )
  and (
    current_action_work_record_id is null
    or exists (
      select 1 from public.work_records wr
      where wr.id = current_action_work_record_id
        and wr.workspace_id = workspace_id
        and wr.created_by_user_id = (select auth.uid())
    )
  )
);

create policy insurance_cases_delete_creator
on public.insurance_cases for delete to authenticated
using (
  (select private.can_access_workspace(workspace_id))
  and created_by_user_id = (select auth.uid())
);

create policy insurance_case_links_select_member
on public.insurance_case_work_records for select to authenticated
using ((select private.can_access_workspace(workspace_id)));

create policy insurance_case_links_insert_creator
on public.insurance_case_work_records for insert to authenticated
with check (
  (select private.can_access_workspace(workspace_id))
  and linked_by_user_id = (select auth.uid())
  and exists (
    select 1 from public.insurance_cases ic
    where ic.id = insurance_case_id
      and ic.workspace_id = workspace_id
      and ic.created_by_user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.work_records wr
    where wr.id = work_record_id
      and wr.workspace_id = workspace_id
      and wr.created_by_user_id = (select auth.uid())
  )
);

create policy insurance_case_links_delete_creator
on public.insurance_case_work_records for delete to authenticated
using (
  (select private.can_access_workspace(workspace_id))
  and linked_by_user_id = (select auth.uid())
);

create or replace function public.create_my_insurance_case(
  p_client_request_id text,
  p_original_work_record_id uuid,
  p_customer_key text,
  p_title text
)
returns table (
  insurance_case_id uuid,
  workspace_id uuid,
  customer_key text,
  title text,
  status text,
  original_work_record_id uuid,
  current_action_work_record_id uuid,
  revision integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
  v_case public.insurance_cases%rowtype;
  v_request_id text := btrim(coalesce(p_client_request_id, ''));
  v_customer_key text := upper(btrim(coalesce(p_customer_key, '')));
  v_title text := btrim(coalesce(p_title, ''));
begin
  if v_user_id is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if char_length(v_request_id) < 16 or char_length(v_request_id) > 100 then raise exception 'INSURANCE_CASE_REQUEST_ID_INVALID'; end if;
  if v_customer_key !~ '^P-([A-F0-9]{12}|DEV-[A-Z0-9]{4,32})$' then raise exception 'INSURANCE_CASE_CUSTOMER_KEY_INVALID'; end if;
  if char_length(v_title) < 1 or char_length(v_title) > 200 then raise exception 'INSURANCE_CASE_TITLE_INVALID'; end if;

  select w.id into v_workspace_id
  from public.workspaces w
  where w.owner_user_id = v_user_id and w.kind = 'personal'
  order by w.created_at asc limit 1;
  if v_workspace_id is null then raise exception 'PERSONAL_WORKSPACE_MISSING'; end if;

  if not exists (
    select 1 from public.work_records wr
    where wr.id = p_original_work_record_id
      and wr.workspace_id = v_workspace_id
      and wr.created_by_user_id = v_user_id
  ) then
    raise exception 'INSURANCE_CASE_ORIGINAL_NOT_FOUND_OR_FORBIDDEN';
  end if;

  insert into public.insurance_cases (
    workspace_id, created_by_user_id, client_request_id, customer_key,
    title, status, original_work_record_id
  ) values (
    v_workspace_id, v_user_id, v_request_id, v_customer_key,
    v_title, 'intake', p_original_work_record_id
  )
  on conflict (workspace_id, client_request_id) do nothing
  returning * into v_case;

  if v_case.id is null then
    select * into v_case
    from public.insurance_cases ic
    where ic.workspace_id = v_workspace_id and ic.client_request_id = v_request_id;
    if v_case.original_work_record_id <> p_original_work_record_id
      or v_case.customer_key <> v_customer_key
      or v_case.title <> v_title then
      raise exception 'INSURANCE_CASE_REQUEST_REUSE_CONFLICT';
    end if;
  end if;

  insert into public.insurance_case_work_records (
    insurance_case_id, workspace_id, work_record_id, role, linked_by_user_id
  ) values (
    v_case.id, v_workspace_id, p_original_work_record_id, 'original', v_user_id
  ) on conflict (insurance_case_id, work_record_id) do nothing;

  return query select v_case.id, v_case.workspace_id, v_case.customer_key,
    v_case.title, v_case.status, v_case.original_work_record_id,
    v_case.current_action_work_record_id, v_case.revision;
end;
$$;

create or replace function public.create_my_insurance_case_action(
  p_insurance_case_id uuid,
  p_client_request_id text,
  p_title text,
  p_due_at timestamptz default null
)
returns table (
  insurance_case_id uuid,
  action_work_record_id uuid,
  action_status text,
  action_due_at timestamptz,
  case_revision integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_case public.insurance_cases%rowtype;
  v_request_id text := btrim(coalesce(p_client_request_id, ''));
  v_title text := btrim(coalesce(p_title, ''));
  v_work_record_id uuid;
  v_source_ref_id uuid;
  v_existing public.work_records%rowtype;
begin
  if v_user_id is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if char_length(v_request_id) < 16 or char_length(v_request_id) > 100 then raise exception 'INSURANCE_ACTION_REQUEST_ID_INVALID'; end if;
  if char_length(v_title) < 1 or char_length(v_title) > 200 then raise exception 'INSURANCE_ACTION_TITLE_INVALID'; end if;

  select * into v_case
  from public.insurance_cases ic
  where ic.id = p_insurance_case_id and ic.created_by_user_id = v_user_id
  for update;
  if v_case.id is null then raise exception 'INSURANCE_CASE_NOT_FOUND_OR_FORBIDDEN'; end if;
  if v_case.status = 'closed' then raise exception 'INSURANCE_CASE_CLOSED'; end if;

  select * into v_existing
  from public.work_records wr
  where wr.workspace_id = v_case.workspace_id
    and wr.client_request_id = v_request_id;

  if v_existing.id is not null then
    if v_existing.created_by_user_id <> v_user_id
      or coalesce(v_existing.metadata ->> 'insuranceCaseId', '') <> p_insurance_case_id::text
      or v_existing.title <> v_title
      or v_existing.due_at is distinct from p_due_at then
      raise exception 'INSURANCE_ACTION_REQUEST_REUSE_CONFLICT';
    end if;
    v_work_record_id := v_existing.id;
  else
    select saved.work_record_id, saved.source_ref_id
    into v_work_record_id, v_source_ref_id
    from public.save_my_worklog(
      v_request_id,
      v_title,
      v_title,
      v_title,
      'task',
      'in_progress',
      null,
      null,
      null,
      now(),
      p_due_at,
      jsonb_build_object(
        'source', 'insurance_case',
        'insuranceCaseId', p_insurance_case_id,
        'dueTimeExplicit', false
      ),
      v_title
    ) saved;
  end if;

  insert into public.insurance_case_work_records (
    insurance_case_id, workspace_id, work_record_id, role, linked_by_user_id
  ) values (
    p_insurance_case_id, v_case.workspace_id, v_work_record_id, 'action', v_user_id
  ) on conflict (insurance_case_id, work_record_id) do nothing;

  if v_case.current_action_work_record_id is distinct from v_work_record_id then
    update public.insurance_cases ic
    set current_action_work_record_id = v_work_record_id,
        revision = ic.revision + 1
    where ic.id = p_insurance_case_id
    returning ic.revision into v_case.revision;
  end if;

  return query
  select p_insurance_case_id, wr.id, wr.status, wr.due_at, v_case.revision
  from public.work_records wr where wr.id = v_work_record_id;
end;
$$;

create or replace function public.update_my_insurance_case(
  p_insurance_case_id uuid,
  p_expected_revision integer,
  p_title text,
  p_status text,
  p_waiting_party text default null,
  p_waiting_reason text default null
)
returns table (
  insurance_case_id uuid,
  title text,
  status text,
  waiting_party text,
  waiting_reason text,
  revision integer,
  closed_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_title text := btrim(coalesce(p_title, ''));
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_party text := nullif(lower(btrim(coalesce(p_waiting_party, ''))), '');
  v_reason text := nullif(btrim(coalesce(p_waiting_reason, '')), '');
  v_case public.insurance_cases%rowtype;
begin
  if v_user_id is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if coalesce(p_expected_revision, 0) < 1 then raise exception 'INSURANCE_CASE_REVISION_INVALID'; end if;
  if char_length(v_title) < 1 or char_length(v_title) > 200 then raise exception 'INSURANCE_CASE_TITLE_INVALID'; end if;
  if v_status not in ('intake', 'checking', 'waiting', 'active', 'closed') then raise exception 'INSURANCE_CASE_STATUS_INVALID'; end if;
  if v_party is not null and v_party not in ('customer', 'insurer', 'internal', 'external') then raise exception 'INSURANCE_CASE_WAITING_PARTY_INVALID'; end if;
  if v_reason is not null and char_length(v_reason) > 1000 then raise exception 'INSURANCE_CASE_WAITING_REASON_INVALID'; end if;

  update public.insurance_cases ic
  set title = v_title,
      status = v_status,
      waiting_party = v_party,
      waiting_reason = v_reason,
      closed_at = case when v_status = 'closed' then coalesce(ic.closed_at, now()) else null end,
      revision = ic.revision + 1
  where ic.id = p_insurance_case_id
    and ic.created_by_user_id = v_user_id
    and ic.revision = p_expected_revision
  returning * into v_case;

  if v_case.id is null then
    if exists (
      select 1 from public.insurance_cases ic
      where ic.id = p_insurance_case_id and ic.created_by_user_id = v_user_id
    ) then
      raise exception 'INSURANCE_CASE_REVISION_CONFLICT';
    end if;
    raise exception 'INSURANCE_CASE_NOT_FOUND_OR_FORBIDDEN';
  end if;

  return query select v_case.id, v_case.title, v_case.status,
    v_case.waiting_party, v_case.waiting_reason, v_case.revision, v_case.closed_at;
end;
$$;

create or replace function public.list_my_insurance_cases()
returns table (
  insurance_case_id uuid,
  customer_key text,
  title text,
  status text,
  waiting_party text,
  waiting_reason text,
  original_work_record_id uuid,
  current_action_work_record_id uuid,
  current_action_title text,
  current_action_status text,
  current_action_due_at timestamptz,
  revision integer,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select ic.id, ic.customer_key, ic.title, ic.status,
    ic.waiting_party, ic.waiting_reason, ic.original_work_record_id,
    ic.current_action_work_record_id, action.title, action.status, action.due_at,
    ic.revision, ic.updated_at
  from public.insurance_cases ic
  left join public.work_records action on action.id = ic.current_action_work_record_id
  where ic.created_by_user_id = (select auth.uid())
  order by (ic.status = 'closed') asc,
    action.due_at asc nulls last,
    ic.updated_at desc;
$$;

create or replace function public.get_my_insurance_case(p_insurance_case_id uuid)
returns table (
  insurance_case_id uuid,
  customer_key text,
  title text,
  status text,
  waiting_party text,
  waiting_reason text,
  original_work_record_id uuid,
  original_work_record_title text,
  current_action_work_record_id uuid,
  current_action_title text,
  current_action_status text,
  current_action_due_at timestamptz,
  revision integer,
  closed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select ic.id, ic.customer_key, ic.title, ic.status,
    ic.waiting_party, ic.waiting_reason,
    original.id, original.title,
    action.id, action.title, action.status, action.due_at,
    ic.revision, ic.closed_at, ic.created_at, ic.updated_at
  from public.insurance_cases ic
  join public.work_records original on original.id = ic.original_work_record_id
  left join public.work_records action on action.id = ic.current_action_work_record_id
  where ic.id = p_insurance_case_id
    and ic.created_by_user_id = (select auth.uid());
$$;

revoke all on function public.create_my_insurance_case(text, uuid, text, text) from public, anon;
revoke all on function public.create_my_insurance_case_action(uuid, text, text, timestamptz) from public, anon;
revoke all on function public.update_my_insurance_case(uuid, integer, text, text, text, text) from public, anon;
revoke all on function public.list_my_insurance_cases() from public, anon;
revoke all on function public.get_my_insurance_case(uuid) from public, anon;

grant execute on function public.create_my_insurance_case(text, uuid, text, text) to authenticated, service_role;
grant execute on function public.create_my_insurance_case_action(uuid, text, text, timestamptz) to authenticated, service_role;
grant execute on function public.update_my_insurance_case(uuid, integer, text, text, text, text) to authenticated, service_role;
grant execute on function public.list_my_insurance_cases() to authenticated, service_role;
grant execute on function public.get_my_insurance_case(uuid) to authenticated, service_role;
