-- One read snapshot for Work counts + paginated rows. No record/organization writes.
-- Old folder/today RPCs remain compatible with already-installed APKs.
create or replace function worklog.get_my_work_overview(
 p_all boolean default true, p_folder uuid default null,
 p_section text default 'tasks', p_offset integer default 0
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_section is null or p_section not in ('tasks','notes','completed') then raise exception 'INVALID_SECTION'; end if;
 with recursive folders as materialized (
  select id,name,parent_id,version from worklog.work_folders where user_id=(select auth.uid())
 ), descendants(root,id) as (
  select id,id from folders
  union
  select d.root,f.id from descendants d join folders f on f.parent_id=d.id
 ), eligible as materialized (
  select r.id,r.title,r.content,r.original_text,r.status,r.action_kind,r.due_at,r.completed_at,r.recorded_at,r.next_attention_at,r.briefing_state,r.acknowledged_at,
   o.folder_id,o.selected_on,coalesce(o.version,-1) as organization_version,
   case when r.status='completed' or (r.action_kind='note' and r.briefing_state='acknowledged') then 'completed'
    when r.action_kind='note' and r.briefing_state='active' then 'notes'
    when r.status in ('in_progress','waiting','needs_review') and r.action_kind is distinct from 'note' then 'tasks'
   end as section
  from worklog.work_records r join worklog.workspaces w on w.id=r.workspace_id
  left join worklog.work_organization o on o.work_record_id=r.id and o.user_id=(select auth.uid())
  where w.kind='personal' and w.owner_user_id=(select auth.uid()) and r.status<>'cancelled'
   and not exists(select 1 from worklog.repeating_work rw where rw.work_record_id=r.id)
   and (r.metadata #>> '{actionEngine,kind}') is distinct from 'schedule'
   and not exists(select 1 from worklog.schedules s where s.workspace_id=r.workspace_id and s.metadata->>'workRecordId'=r.id::text and s.status<>'cancelled')
 ), scoped as materialized (
  select e.*,case when p_section='completed' then coalesce(e.completed_at,e.acknowledged_at,e.recorded_at) else e.recorded_at end as sort_at
  from eligible e where e.section=p_section and (
   p_all is true or (p_folder is null and e.folder_id is null)
   or exists(select 1 from descendants d where d.root=p_folder and d.id=e.folder_id)
  )
 ), page as (
  select * from scoped order by sort_at desc,id limit 50 offset greatest(coalesce(p_offset,0),0)
 ), counted_folders as (
  select f.*, (select count(*) from eligible e where e.section='tasks' and exists(select 1 from descendants d where d.root=f.id and d.id=e.folder_id)) as task_count
  from folders f
 )
 select jsonb_build_object(
  'folders',coalesce((select jsonb_agg(to_jsonb(f) order by f.name,f.id) from counted_folders f),'[]'::jsonb),
  'records',coalesce((select jsonb_agg(to_jsonb(p)-'section'-'sort_at' order by p.sort_at desc,p.id) from page p),'[]'::jsonb),
  'all_tasks',(select count(*) from eligible where section='tasks'),
  'unclassified_tasks',(select count(*) from eligible where section='tasks' and folder_id is null),
  'total_count',(select count(*) from scoped)
 ) into result;
 return result;
end $$;
revoke all on function worklog.get_my_work_overview(boolean,uuid,text,integer) from public,anon;
grant execute on function worklog.get_my_work_overview(boolean,uuid,text,integer) to authenticated,service_role;
