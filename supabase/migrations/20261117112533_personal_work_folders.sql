-- Additive, LOCAL REVIEW ONLY. No seed folders, record copies or production apply.
-- Personal organization is independent of institution, due_at and Schedule.
create table worklog.work_folders (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  parent_id uuid,
  version integer not null default 0,
  unique(id,user_id),
  foreign key(parent_id,user_id) references worklog.work_folders(id,user_id),
  check(parent_id is distinct from id)
);
create index work_folders_owner_parent on worklog.work_folders(user_id,parent_id);
create table worklog.work_organization (
  work_record_id uuid primary key references worklog.work_records(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  folder_id uuid,
  selected_on date,
  version integer not null default 0,
  foreign key(folder_id,user_id) references worklog.work_folders(id,user_id)
);
create index work_organization_owner_folder on worklog.work_organization(user_id,folder_id);
create index work_organization_owner_today on worklog.work_organization(user_id,selected_on) where selected_on is not null;
alter table worklog.work_folders enable row level security;
alter table worklog.work_organization enable row level security;
revoke all on worklog.work_folders,worklog.work_organization from public,anon,authenticated;
grant select,insert,update on worklog.work_folders,worklog.work_organization to authenticated;
create policy work_folders_owner on worklog.work_folders for all to authenticated
 using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy work_organization_owner on worklog.work_organization for all to authenticated
 using(user_id=(select auth.uid()) and exists(
  select 1 from worklog.work_records r join worklog.workspaces w on w.id=r.workspace_id
  where r.id=work_record_id and w.kind='personal' and w.owner_user_id=(select auth.uid())
 )) with check(user_id=(select auth.uid()) and exists(
  select 1 from worklog.work_records r join worklog.workspaces w on w.id=r.workspace_id
  where r.id=work_record_id and w.kind='personal' and w.owner_user_id=(select auth.uid())
 ));

-- Enforce the hierarchy even for direct Data API writes. Serialize one user's
-- graph edits before walking ancestors; composite FKs block cross-user parents.
create function worklog.guard_work_folder() returns trigger
 language plpgsql security invoker set search_path='' as $$
begin
 if new.user_id is distinct from auth.uid() then raise exception 'FOLDER_OWNER' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,551));
 if tg_op='UPDATE' and (new.id<>old.id or new.user_id<>old.user_id) then raise exception 'FOLDER_ID_IMMUTABLE'; end if;
 if exists (
  with recursive ancestors(id,parent_id) as (
   select f.id,f.parent_id from worklog.work_folders f where f.id=new.parent_id
   union
   select f.id,f.parent_id from worklog.work_folders f join ancestors a on f.id=a.parent_id
  ) select 1 from ancestors where id=new.id
 ) then raise exception 'FOLDER_CYCLE' using errcode='23514'; end if;
 if tg_op='UPDATE' then new.version=old.version+1; end if;
 return new;
end $$;
create trigger guard_work_folder before insert or update on worklog.work_folders
 for each row execute function worklog.guard_work_folder();

create function worklog.list_my_work_folders() returns jsonb
 language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'parent_id',f.parent_id,'version',f.version) order by f.name,f.id),'[]'::jsonb)
 from worklog.work_folders f where f.user_id=(select auth.uid());
$$;
create function worklog.save_my_work_folder(p_owner uuid,p_id uuid,p_name text,p_parent uuid,p_version integer) returns void
 language plpgsql security invoker set search_path='' as $$
declare f worklog.work_folders;
begin
 if auth.uid() is null or p_owner is distinct from auth.uid() then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,551));
 select * into f from worklog.work_folders where id=p_id for update;
 if f.id is null then
  if p_version is distinct from -1 then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
  insert into worklog.work_folders(id,name,parent_id) values(p_id,btrim(p_name),p_parent);
 else
  -- Same immutable creation ID can be retried after a lost response.
  if p_version=-1 and f.name=btrim(p_name) and f.parent_id is not distinct from p_parent then return; end if;
  if f.version is distinct from p_version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
  update worklog.work_folders set name=btrim(p_name),parent_id=p_parent where id=p_id;
 end if;
end $$;

create function worklog.organize_my_work_record(p_owner uuid,p_id uuid,p_version integer,p_command jsonb) returns void
 language plpgsql security invoker set search_path='' as $$
declare r worklog.work_records; o worklog.work_organization; target uuid; selected date;
begin
 if auth.uid() is null or p_owner is distinct from auth.uid() then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,551));
 select wr.* into r from worklog.work_records wr join worklog.workspaces w on w.id=wr.workspace_id
  where wr.id=p_id and w.kind='personal' and w.owner_user_id=auth.uid() and wr.status<>'cancelled'
  and not exists(select 1 from worklog.repeating_work rw where rw.work_record_id=wr.id)
  and (wr.metadata #>> '{actionEngine,kind}') is distinct from 'schedule'
  and not exists(select 1 from worklog.schedules s where s.workspace_id=wr.workspace_id and s.metadata->>'workRecordId'=wr.id::text and s.status<>'cancelled');
 if r.id is null then raise exception 'WORK_NOT_AVAILABLE' using errcode='42501'; end if;
 select * into o from worklog.work_organization where work_record_id=p_id for update;
 if coalesce(o.version,-1) is distinct from p_version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
 target=o.folder_id; selected=o.selected_on;
 if jsonb_typeof(p_command)='object' and p_command ? 'folder' and p_command - 'folder'='{}'::jsonb then
  target=(p_command->>'folder')::uuid;
 elsif jsonb_typeof(p_command->'today')='boolean' and p_command - 'today'='{}'::jsonb then
  if (p_command->>'today')::boolean then
   if r.due_at is not null or r.action_kind='note' or r.status='completed' then raise exception 'UNDATED_OPEN_TASK_REQUIRED'; end if;
   selected=(now() at time zone 'Asia/Seoul')::date;
  else selected=null; end if;
 else raise exception 'INVALID_COMMAND'; end if;
 insert into worklog.work_organization(work_record_id,folder_id,selected_on) values(p_id,target,selected)
 on conflict(work_record_id) do update set folder_id=excluded.folder_id,selected_on=excluded.selected_on,version=work_organization.version+1;
end $$;

-- Paginate canonical records rather than the truncated home briefing. No task
-- or completion state is copied here. NULL folder means unclassified.
create function worklog.list_my_folder_records(p_folder uuid,p_section text,p_offset integer default 0) returns jsonb
 language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_section not in ('tasks','notes','completed','today') or p_section is null then raise exception 'INVALID_SECTION'; end if;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.recorded_at desc,q.id),'[]'::jsonb) into result from (
  select r.id,r.title,r.content,r.original_text,r.status,r.action_kind,r.due_at,r.completed_at,r.recorded_at,r.next_attention_at,
   o.folder_id,o.selected_on,coalesce(o.version,-1) as organization_version
  from worklog.work_records r join worklog.workspaces w on w.id=r.workspace_id
  left join worklog.work_organization o on o.work_record_id=r.id and o.user_id=(select auth.uid())
  where w.kind='personal' and w.owner_user_id=(select auth.uid()) and r.status<>'cancelled'
   and not exists(select 1 from worklog.repeating_work rw where rw.work_record_id=r.id)
   and (r.metadata #>> '{actionEngine,kind}') is distinct from 'schedule'
   and not exists(select 1 from worklog.schedules s where s.workspace_id=r.workspace_id and s.metadata->>'workRecordId'=r.id::text and s.status<>'cancelled')
   and (p_section='today' or o.folder_id is not distinct from p_folder)
   and case p_section
    when 'notes' then r.action_kind='note'
    when 'completed' then r.status='completed' and r.action_kind is distinct from 'note'
    when 'tasks' then r.status in ('in_progress','waiting','needs_review') and r.action_kind is distinct from 'note'
    when 'today' then r.status in ('in_progress','waiting','needs_review') and r.action_kind is distinct from 'note'
      and o.selected_on <= (now() at time zone 'Asia/Seoul')::date
   end
  order by r.recorded_at desc,r.id limit 50 offset greatest(coalesce(p_offset,0),0)
 ) q;
 return result;
end $$;
revoke all on function worklog.guard_work_folder(),worklog.list_my_work_folders(),worklog.save_my_work_folder(uuid,uuid,text,uuid,integer),worklog.organize_my_work_record(uuid,uuid,integer,jsonb),worklog.list_my_folder_records(uuid,text,integer) from public,anon;
grant execute on function worklog.list_my_work_folders(),worklog.save_my_work_folder(uuid,uuid,text,uuid,integer),worklog.organize_my_work_record(uuid,uuid,integer,jsonb),worklog.list_my_folder_records(uuid,text,integer) to authenticated;
