-- LOCAL ONLY: explicit approval required before applying to the shared remote DB.
-- A repeating series attaches to the existing canonical WorkRecord, never a second copy.
create table worklog.repeating_work (
  work_record_id uuid primary key references worklog.work_records(id),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  version integer not null default 0 check (version >= 0),
  state jsonb not null check (jsonb_typeof(state) = 'object')
);
create table worklog.repeating_work_requests (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  request_id uuid not null,
  work_record_id uuid not null references worklog.repeating_work(work_record_id) on delete cascade,
  command jsonb not null,
  created_at timestamptz not null default now(),
  result jsonb not null,
  primary key(user_id,request_id)
);
alter table worklog.repeating_work enable row level security;
alter table worklog.repeating_work_requests enable row level security;
revoke all on worklog.repeating_work,worklog.repeating_work_requests from anon,authenticated;
grant select,insert,update on worklog.repeating_work to authenticated;
grant select,insert on worklog.repeating_work_requests to authenticated;
create policy repeating_work_owner on worklog.repeating_work for all to authenticated
  using (user_id = (select auth.uid()) and exists(select 1 from worklog.work_records w where w.id=work_record_id and w.created_by_user_id=(select auth.uid()))) with check (user_id = (select auth.uid()) and exists (
    select 1 from worklog.work_records w where w.id=work_record_id and w.created_by_user_id=(select auth.uid())
  ));
create policy repeating_work_requests_owner on worklog.repeating_work_requests for all to authenticated
  using (user_id = (select auth.uid()) and exists(select 1 from worklog.repeating_work w where w.work_record_id=repeating_work_requests.work_record_id)) with check (user_id = (select auth.uid()) and exists (
    select 1 from worklog.repeating_work w where w.work_record_id=repeating_work_requests.work_record_id and w.user_id=(select auth.uid())
  ));

create function worklog.validate_repeat_revision(r jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare d date; n integer; w jsonb;
begin
  d := (r->'rule'->>'anchor')::date; n := (r->'rule'->>'interval')::integer;
  if jsonb_typeof(r->'title') is distinct from 'string' or (r->>'time' is not null and jsonb_typeof(r->'time') is distinct from 'string') or d is null or d < date '1900-01-01' or d > date '2199-12-31' or n is null or n not between 1 and 365
    or coalesce(r->'rule'->>'kind','') not in ('daily','weekly','monthly','yearly','after-completion')
    or coalesce(r->'rule'->>'unit','') not in ('day','week')
    or coalesce(jsonb_typeof(r->'rule'->'weekdays'),'') <> 'array'
    or coalesce(char_length(btrim(r->>'title')),0) not between 1 and 300
    or coalesce(r->>'time','') !~ '^$|^([01][0-9]|2[0-3]):[0-5][0-9]$' then return false; end if;
  for w in select * from jsonb_array_elements(r->'rule'->'weekdays') loop
    if (w#>>'{}')::integer not between 1 and 7 then return false; end if;
  end loop;
  return r->'rule'->>'kind' <> 'weekly' or jsonb_array_length(r->'rule'->'weekdays') > 0;
exception when others then return false;
end $$;
revoke all on function worklog.validate_repeat_revision(jsonb) from public,anon;
grant execute on function worklog.validate_repeat_revision(jsonb) to authenticated;

-- Reconstruct the logical date to reject invented/moved occurrence identifiers.
create function worklog.repeat_occurrence_date(s jsonb,k text) returns date
language plpgsql stable security invoker set search_path='' as $$
declare r jsonb; rule jsonb; d date; a date; n integer; step integer; i integer; previous jsonb; week_no integer; pause jsonb;
begin
  select value into r from jsonb_array_elements(s->'revisions') where 'v'||(value->>'version')=split_part(k,':',1);
  if r is null then return null; end if;
  rule:=r->'rule'; a:=(rule->>'anchor')::date; step:=(rule->>'interval')::integer;
  if rule->>'kind'='after-completion' then
    if split_part(k,':',2) !~ '^i[0-9]+$' then return null; end if;
    n:=substring(k from ':i([0-9]+)$')::integer;
    if n>(select count(*) from jsonb_object_keys(s->'occurrences')) then return null; end if;
    d:=a;
    if n>0 then for i in 0..n-1 loop
      previous:=s->'occurrences'->(split_part(k,':',1)||':i'||i);
      if previous->>'status'='completed' then d:=(previous->>'completedOn')::date + step * case when rule->>'unit'='week' then 7 else 1 end;
      elsif previous->>'status'='skipped' then d:=(previous->>'nextDate')::date;
      else return null; end if;
      if d is null then return null; end if;
    end loop; end if;
  else
    d:=split_part(k,':',2)::date;
    if d<a then return null; end if;
    if rule->>'kind'='daily' and (d-a)%step<>0 then return null;
    elsif rule->>'kind'='weekly' then
      week_no:=floor((d-(a-(extract(isodow from a)::integer-1)))::numeric/7)::integer;
      if week_no%step<>0 or not (rule->'weekdays' @> jsonb_build_array(extract(isodow from d)::integer)) then return null; end if;
    elsif rule->>'kind' in ('monthly','yearly') then
      if (rule->>'kind'='monthly' and ((extract(year from d)::integer-extract(year from a)::integer)*12+extract(month from d)::integer-extract(month from a)::integer)%step<>0)
        or (rule->>'kind'='yearly' and ((extract(year from d)::integer-extract(year from a)::integer)%step<>0 or extract(month from d)<>extract(month from a)))
        or extract(day from d)<>least(extract(day from a),extract(day from (date_trunc('month',d)+interval '1 month - 1 day'))) then return null; end if;
    end if;
  end if;
  if rule->>'kind'='after-completion' then
    for pause in select * from jsonb_array_elements(s->'pauses') loop
      if pause->>'to' is not null and d>=(pause->>'from')::date and d<(pause->>'to')::date then d:=(pause->>'to')::date; end if;
    end loop;
  end if;
  if d<(r->>'from')::date or exists(select 1 from jsonb_array_elements(s->'revisions') v where (v->>'version')::integer>(r->>'version')::integer and (v->>'from')::date<=d) then return null; end if;
  return d;
exception when others then return null;
end $$;
revoke all on function worklog.repeat_occurrence_date(jsonb,text) from public,anon;
grant execute on function worklog.repeat_occurrence_date(jsonb,text) to authenticated;

-- All application writes are serialized per canonical record and checked against an expected version.
-- Request receipts survive restarts; retrying an identical request returns the original result.
create function worklog.mutate_repeating_work(p_work_record_id uuid,p_request_id uuid,p_expected_version integer,p_command jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare current_row worklog.repeating_work; s jsonb; receipt worklog.repeating_work_requests;
  today date := (now() at time zone 'Asia/Seoul')::date;
  op text := p_command->>'op'; k text := p_command->>'key'; original_day date; due_day date;
  rev jsonb; old jsonb; item jsonb; result jsonb; pause jsonb; index_no integer;
begin
  if auth.uid() is null or p_request_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  -- Parent lock serializes creates as well as updates and cannot lock another owner's record.
  perform 1 from worklog.work_records where id=p_work_record_id and created_by_user_id=auth.uid() for update;
  if not found then raise exception 'RECORD_NOT_AVAILABLE' using errcode='42501'; end if;
  select * into receipt from worklog.repeating_work_requests where user_id=auth.uid() and request_id=p_request_id;
  if found then
    if receipt.work_record_id<>p_work_record_id or receipt.command<>p_command then raise exception 'REQUEST_CHANGED'; end if;
    select to_jsonb(w) into result from worklog.repeating_work w where w.work_record_id=p_work_record_id;
    return result;
  end if;
  select * into current_row from worklog.repeating_work where work_record_id=p_work_record_id for update;
  if op='create' then
    if current_row.work_record_id is not null then
      -- Canonical WorkRecord is the stable registration identity across app restarts.
      if ((current_row.state->'revisions'->0) - 'version' - 'from') = ((p_command->'revision') - 'version' - 'from') then
        result:=to_jsonb(current_row);
        insert into worklog.repeating_work_requests(request_id,work_record_id,command,result)
          values(p_request_id,p_work_record_id,p_command,jsonb_build_object('work_record_id',current_row.work_record_id,'version',current_row.version));
        return result;
      end if;
      raise exception 'VERSION_CONFLICT' using errcode='40001';
    end if;
    if p_expected_version is distinct from -1 then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
    rev:=p_command->'revision';
    if not worklog.validate_repeat_revision(rev) then raise exception 'INVALID_REPEAT_RULE'; end if;
    rev:=jsonb_set(rev,'{rule,anchor}',to_jsonb((rev->'rule'->>'anchor')::date::text));
    rev:=rev || jsonb_build_object('version',1,'from',rev->'rule'->>'anchor','time',coalesce(rev->>'time',''));
    s:=jsonb_build_object('revisions',jsonb_build_array(rev),'pauses','[]'::jsonb,'endedOn',null,'occurrences','{}'::jsonb);
    insert into worklog.repeating_work(work_record_id,state) values(p_work_record_id,s) returning * into current_row;
  else
    if current_row.work_record_id is null or current_row.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
    s:=current_row.state;
    if op in ('complete','undo','skip','move','next-date') then
      original_day:=(p_command->>'originalDate')::date;
      due_day:=coalesce((p_command->>'dueDate')::date,original_day);
      if original_day is null or k is null or k !~ '^v[0-9]+:(i[0-9]+|[0-9]{4}-[0-9]{2}-[0-9]{2})$' then raise exception 'INVALID_OCCURRENCE'; end if;
      select value into rev from jsonb_array_elements(s->'revisions') where 'v'||(value->>'version')||':'=split_part(k,':',1)||':';
      if rev is null or original_day<(rev->>'from')::date then raise exception 'INVALID_OCCURRENCE'; end if;
      old:=s->'occurrences'->k;
      if old is null and (worklog.repeat_occurrence_date(s,k) is distinct from original_day
        or (s->>'endedOn' is not null and original_day >= (s->>'endedOn')::date)
        or exists(select 1 from jsonb_array_elements(s->'pauses') v where original_day >= (v->>'from')::date and (v->>'to' is null or original_day < (v->>'to')::date))) then raise exception 'INVALID_OCCURRENCE'; end if;

      if old is not null and old->>'originalDate'<>original_day::text then raise exception 'OCCURRENCE_CHANGED'; end if;
      if op='undo' then
        if old is null or old->>'status'='pending' then raise exception 'NOT_COMPLETED'; end if;
        -- Interval undo cannot erase a later processed occurrence.
        if rev->'rule'->>'kind'='after-completion' and exists(select 1 from jsonb_each(s->'occurrences') e
          where e.key like split_part(k,':',1)||':i%' and substring(e.key from ':i([0-9]+)$')::integer > substring(k from ':i([0-9]+)$')::integer and e.value->>'status'<>'pending') then raise exception 'LATER_OCCURRENCE_EXISTS'; end if;
        item:=old || jsonb_build_object('status','pending','completedOn',null,'nextDate',null);
      elsif op='next-date' then
        if old is null or old->>'status'<>'skipped' or rev->'rule'->>'kind'<>'after-completion' or (p_command->>'nextDate')::date<=original_day then raise exception 'INVALID_NEXT_DATE'; end if;
        item:=old || jsonb_build_object('nextDate',p_command->>'nextDate');
      else
        if old->>'status' in ('completed','skipped') then raise exception 'OCCURRENCE_ALREADY_PROCESSED'; end if;
        item:=coalesce(old,jsonb_build_object('key',k,'originalDate',original_day::text,'dueDate',original_day::text,'status','pending','completedOn',null));
        if op='complete' then item:=item || jsonb_build_object('status','completed','completedOn',today::text);
        elsif op='skip' then item:=item || jsonb_build_object('status','skipped','completedOn',null,'nextDate',null);
        elsif op='move' then
          if due_day is null or coalesce(char_length(btrim(p_command->>'title')),0) not between 1 and 300 or coalesce(p_command->>'time','') !~ '^$|^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'INVALID_OCCURRENCE'; end if;
          item:=item || jsonb_build_object('dueDate',due_day::text,'title',p_command->>'title') || case when p_command ? 'time' then jsonb_build_object('time',p_command->>'time') else '{}'::jsonb end;
        end if;
      end if;
      s:=jsonb_set(s,array['occurrences',k],item);
    elsif op='revise' then
      rev:=p_command->'revision';
      if not worklog.validate_repeat_revision(rev) or jsonb_typeof(rev->'from') is distinct from 'string' or rev->>'from' is null or (rev->>'from')::date<today or (rev->>'from')::date <= (s->'revisions'->-1->>'from')::date then raise exception 'INVALID_FUTURE_REVISION'; end if;
      rev:=jsonb_set(rev,'{rule,anchor}',to_jsonb((rev->'rule'->>'anchor')::date::text));
      rev:=rev || jsonb_build_object('version',jsonb_array_length(s->'revisions')+1,'from',(rev->>'from')::date::text,'time',coalesce(rev->>'time',''));
      s:=jsonb_set(s,'{revisions}',s->'revisions'||jsonb_build_array(rev));
    elsif op='pause' then
      if s->>'endedOn' is not null or exists(select 1 from jsonb_array_elements(s->'pauses') v where v->>'to' is null) then raise exception 'ALREADY_STOPPED'; end if;
      s:=jsonb_set(s,'{pauses}',s->'pauses'||jsonb_build_array(jsonb_build_object('from',today::text,'to',null)));
    elsif op='resume' then
      index_no:=jsonb_array_length(s->'pauses')-1;
      if s->>'endedOn' is not null or index_no<0 or s->'pauses'->index_no->>'to' is not null then raise exception 'NOT_PAUSED'; end if;
      s:=jsonb_set(s,array['pauses',index_no::text,'to'],to_jsonb(today::text));
    elsif op='end' then s:=jsonb_set(s,'{endedOn}',to_jsonb(today::text));
    else raise exception 'INVALID_COMMAND'; end if;
    update worklog.repeating_work set state=s,version=version+1 where work_record_id=p_work_record_id returning * into current_row;
  end if;
  result:=to_jsonb(current_row);
  insert into worklog.repeating_work_requests(request_id,work_record_id,command,result) values(p_request_id,p_work_record_id,p_command,jsonb_build_object('work_record_id',current_row.work_record_id,'version',current_row.version));
  return result;
end $$;
revoke all on function worklog.mutate_repeating_work(uuid,uuid,integer,jsonb) from public,anon;
grant execute on function worklog.mutate_repeating_work(uuid,uuid,integer,jsonb) to authenticated;

-- ERP consumes this read-only projection and opens the existing app for changes.
-- No future WorkRecords or Schedule rows are created. Both series and canonical parent RLS apply.
create function worklog.get_my_repeating_work_month(p_month date) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare first_day date:=date_trunc('month',p_month)::date; last_day date:=(date_trunc('month',p_month)+interval '1 month - 1 day')::date; result jsonb;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if first_day is null or first_day<date '1900-01-01' or last_day>date '2199-12-31' then raise exception 'INVALID_MONTH'; end if;
 with revisions as (
  select w.work_record_id,w.state,r.value as revision from worklog.repeating_work w
  join worklog.work_records original on original.id=w.work_record_id and original.created_by_user_id=auth.uid()
  cross join lateral jsonb_array_elements(w.state->'revisions') r
 ), candidates as (
  select r.*, 'v'||(revision->>'version')||':'||d::date::text as key from revisions r
  cross join lateral generate_series(first_day::timestamp,last_day::timestamp,interval '1 day') d where revision->'rule'->>'kind'<>'after-completion'
  union all
  select r.*, 'v'||(revision->>'version')||':i'||i from revisions r
  cross join lateral generate_series(0,(select count(*)::integer from jsonb_object_keys(state->'occurrences'))) i where revision->'rule'->>'kind'='after-completion'
  union all
  select r.*, k from revisions r cross join lateral jsonb_object_keys(state->'occurrences') k where split_part(k,':',1)='v'||(revision->>'version')
 ), resolved as (
  select distinct on(work_record_id,key) *,state->'occurrences'->key as saved,
   coalesce((state->'occurrences'->key->>'originalDate')::date,worklog.repeat_occurrence_date(state,key)) as original_date
  from candidates order by work_record_id,key
 ), rows as (
  select *,coalesce((saved->>'dueDate')::date,original_date) as due_date,coalesce(saved->>'status','pending') as status from resolved
 ), visible as (
  select *,coalesce(saved->>'time',revision->>'time') as time from rows
  where original_date is not null and due_date between first_day and last_day
  and ((status<>'pending') or (
   worklog.repeat_occurrence_date(state,key) is not null
   and (state->>'endedOn' is null or original_date<(state->>'endedOn')::date)
   and not exists(select 1 from jsonb_array_elements(state->'pauses') p where original_date>=(p->>'from')::date and (p->>'to' is null or original_date<(p->>'to')::date))
  ))
 ), bounded as (select * from visible order by due_date,work_record_id,key limit 2001)
 select jsonb_build_object('events',coalesce((select jsonb_agg(jsonb_build_object(
   'work_record_id',work_record_id,'key',key,'title',coalesce(saved->>'title',revision->>'title'),
   'date',due_date::text,'time',time,'status',status,'editable',false,
   'app_path','repeating-work?id='||work_record_id::text||'&date='||due_date::text
 ) order by due_date,work_record_id,key) from (select * from bounded limit 2000) b),'[]'::jsonb),
 'limited',(select count(*)>2000 from bounded),'readonly',true) into result;
 return result;
end $$;
revoke all on function worklog.get_my_repeating_work_month(date) from public,anon;
grant execute on function worklog.get_my_repeating_work_month(date) to authenticated;

-- Support the existing owner-filtered list/week queries.
create index repeating_work_owner_id on worklog.repeating_work(user_id,work_record_id);

-- A stale Home/ERP client must not complete/edit the canonical series parent as a one-off task.
-- Existing atomic Core RPCs retain their implementation and roll back on this guard.
create function worklog.guard_repeating_work_parent() returns trigger
language plpgsql volatile security invoker set search_path='' as $$
declare changed boolean;
begin
 if tg_op='DELETE' then changed:=true;
 else changed:= old.title is distinct from new.title or old.status is distinct from new.status
   or old.due_at is distinct from new.due_at or old.action_kind is distinct from new.action_kind
   or old.completed_at is distinct from new.completed_at or old.next_attention_at is distinct from new.next_attention_at;
 end if;
 if changed and exists(select 1 from worklog.repeating_work r where r.work_record_id=old.id) then
  raise exception 'REPEATING_WORK_USE_OCCURRENCE: 반복 업무는 회차 상세에서 처리해주세요.' using errcode='P0001';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function worklog.guard_repeating_work_parent() from public,anon;
grant execute on function worklog.guard_repeating_work_parent() to authenticated;
create trigger repeating_work_parent_update_guard
 before update of title,status,due_at,action_kind,completed_at,next_attention_at on worklog.work_records
 for each row execute function worklog.guard_repeating_work_parent();
create trigger repeating_work_parent_delete_guard
 before delete on worklog.work_records for each row execute function worklog.guard_repeating_work_parent();
