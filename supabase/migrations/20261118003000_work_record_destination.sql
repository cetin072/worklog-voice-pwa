-- Explicit user conversion. No backfill, record copy, or external calendar deletion.
create function worklog.get_my_work_record_destination(p_id uuid) returns jsonb
 language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('updatedAt',r.updated_at,'folderId',o.folder_id,'version',coalesce(o.version,-1))
 from worklog.work_records r join worklog.workspaces w on w.id=r.workspace_id
 left join worklog.work_organization o on o.work_record_id=r.id and o.user_id=auth.uid()
 where r.id=p_id and w.kind='personal' and w.owner_user_id=auth.uid() and r.created_by_user_id=auth.uid()
 and r.status in ('in_progress','waiting','needs_review')
 and not exists(select 1 from worklog.repeating_work rw where rw.work_record_id=r.id);
$$;

create function worklog.move_my_work_record_to_folder(
 p_owner uuid,p_id uuid,p_title text,p_kind text,p_folder uuid,p_updated_at timestamptz,p_version integer
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r worklog.work_records; o worklog.work_organization; ids uuid[];
begin
 if auth.uid() is null or p_owner is distinct from auth.uid() then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('task','note') or char_length(btrim(coalesce(p_title,''))) not between 1 and 160 then raise exception 'INVALID_DESTINATION'; end if;
 -- Same organization lock order as folder mutations; then serialize the record edit.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,551));
 select wr.* into r from worklog.work_records wr join worklog.workspaces w on w.id=wr.workspace_id
 where wr.id=p_id and w.kind='personal' and w.owner_user_id=auth.uid() and wr.created_by_user_id=auth.uid()
 and wr.status in ('in_progress','waiting','needs_review')
 and not exists(select 1 from worklog.repeating_work rw where rw.work_record_id=wr.id)
 for update of wr;
 if r.id is null then raise exception 'WORK_NOT_AVAILABLE' using errcode='42501'; end if;
 select * into o from worklog.work_organization where work_record_id=p_id for update;
 if r.updated_at is distinct from p_updated_at or coalesce(o.version,-1) is distinct from p_version then
  raise exception 'VERSION_CONFLICT' using errcode='PT409';
 end if;
 if p_folder is not null and not exists(select 1 from worklog.work_folders where id=p_folder and user_id=auth.uid()) then
  raise exception 'FOLDER_NOT_AVAILABLE' using errcode='42501';
 end if;
 -- Keep schedule rows and external IDs for audit. Only this account's linked schedules.
 update worklog.schedules s set status='cancelled',updated_at=now()
 where s.workspace_id=r.workspace_id and s.created_by_user_id=auth.uid()
 and (s.metadata->>'workRecordId'=r.id::text or s.metadata->>'reminderWorkRecordId'=r.id::text)
 and s.status<>'cancelled';
 select coalesce(array_agg(s.id),'{}'::uuid[]) into ids from worklog.schedules s
 where s.workspace_id=r.workspace_id and s.created_by_user_id=auth.uid() and s.status='cancelled'
 and (s.metadata->>'workRecordId'=r.id::text or s.metadata->>'reminderWorkRecordId'=r.id::text);
 update worklog.work_records set title=btrim(p_title),action_kind=p_kind,due_at=null,next_attention_at=null,
 briefing_state='active',acknowledged_at=null,
 metadata=coalesce(r.metadata,'{}'::jsonb) || jsonb_build_object(
  'dueTimeExplicit',false,'actionOverride',jsonb_build_object('kind',p_kind,'source','user_edit','updatedAt',now()),
  'lastWorkDestination',jsonb_build_object('previousDueAt',r.due_at,'previousKind',r.action_kind,'previousFolder',o.folder_id,'changedAt',now()),
  'actionEngine',coalesce(r.metadata->'actionEngine','{}'::jsonb) || jsonb_build_object('kind',p_kind)
 ),updated_at=now()
 where id=r.id;
 insert into worklog.work_organization(work_record_id,folder_id,selected_on) values(r.id,p_folder,null)
 on conflict(work_record_id) do update set folder_id=excluded.folder_id,selected_on=null,version=work_organization.version+1;
 return jsonb_build_object('recordId',r.id,'cancelledScheduleIds',ids,'kind',p_kind,'folderId',p_folder);
end $$;
revoke all on function worklog.get_my_work_record_destination(uuid),worklog.move_my_work_record_to_folder(uuid,uuid,text,text,uuid,timestamptz,integer) from public,anon;
grant execute on function worklog.get_my_work_record_destination(uuid),worklog.move_my_work_record_to_folder(uuid,uuid,text,text,uuid,timestamptz,integer) to authenticated;
