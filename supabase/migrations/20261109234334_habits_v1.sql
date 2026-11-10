-- LOCAL ONLY. No remote deployment or existing data conversion.
create table worklog.habits (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id),
  name text not null check(char_length(btrim(name)) between 1 and 60),
  frequency text not null check(frequency in ('daily','weekdays','weekly-target')),
  weekdays integer[] not null default '{}' check(weekdays <@ array[1,2,3,4,5,6,7]),
  target integer not null check(target between 1 and 7),
  start_date date not null,
  archived_at timestamptz,
  version integer not null default 0 check(version>=0),
  check(frequency<>'weekdays' or cardinality(weekdays)>0)
);
create table worklog.habit_checks (
  habit_id uuid not null references worklog.habits(id),
  user_id uuid not null default auth.uid() references auth.users(id),
  day date not null,
  checked boolean not null,
  version integer not null default 0,
  primary key(habit_id,day)
);
create table worklog.habit_requests (
  user_id uuid not null default auth.uid() references auth.users(id),
  request_id uuid not null,
  habit_id uuid not null references worklog.habits(id),
  command jsonb not null,
  result jsonb not null,
  primary key(user_id,request_id)
);
alter table worklog.habits enable row level security;
alter table worklog.habit_checks enable row level security;
alter table worklog.habit_requests enable row level security;
revoke all on worklog.habits,worklog.habit_checks,worklog.habit_requests from anon,authenticated;
grant select,insert,update on worklog.habits,worklog.habit_checks to authenticated;
grant select,insert on worklog.habit_requests to authenticated;
create policy habits_owner on worklog.habits for all to authenticated
 using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy habit_checks_owner on worklog.habit_checks for all to authenticated
 using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()) and exists(select 1 from worklog.habits h where h.id=habit_id and h.user_id=(select auth.uid())));
create policy habit_requests_owner on worklog.habit_requests for all to authenticated
 using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()) and exists(select 1 from worklog.habits h where h.id=habit_id and h.user_id=(select auth.uid())));
create function worklog.mutate_habit(p_id uuid,p_request_id uuid,p_expected_version integer,p_command jsonb) returns jsonb
 language plpgsql security invoker set search_path='' as $$
declare h worklog.habits; c worklog.habit_checks; receipt worklog.habit_requests; result jsonb;
  v_day date := (now() at time zone 'Asia/Seoul')::date; op text:=p_command->>'op'; draft jsonb:=p_command->'draft';
begin
 if auth.uid() is null or p_id is null or p_request_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 -- Per-user lock also serializes first insert and prevents two request IDs racing creation.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,194));
 select * into receipt from worklog.habit_requests where user_id=auth.uid() and request_id=p_request_id;
 if found then
  if receipt.habit_id<>p_id or receipt.command<>p_command then raise exception 'REQUEST_CHANGED'; end if;
  return receipt.result;
 end if;
 select * into h from worklog.habits where id=p_id for update;
 if op='create' then
  if h.id is not null or p_expected_version is distinct from -1 then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
  insert into worklog.habits(id,name,frequency,weekdays,target,start_date) values(p_id,draft->>'name',draft->>'frequency',array(select jsonb_array_elements_text(draft->'weekdays')::integer),(draft->>'target')::integer,(draft->>'start_date')::date) returning * into h;
  result:=to_jsonb(h);
 elsif op='check' then
  if h.id is null or h.archived_at is not null or v_day<h.start_date or (h.frequency='weekdays' and not (extract(isodow from v_day)::integer=any(h.weekdays))) then raise exception 'HABIT_NOT_DUE'; end if;
  if p_command->>'day' is distinct from v_day::text or jsonb_typeof(p_command->'checked') is distinct from 'boolean' then raise exception 'INVALID_CHECK_DAY'; end if;
  select * into c from worklog.habit_checks where habit_id=p_id and habit_checks.day=v_day for update;
  if p_expected_version is distinct from coalesce(c.version,-1) then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
  insert into worklog.habit_checks(habit_id,day,checked) values(p_id,v_day,(p_command->>'checked')::boolean)
   on conflict(habit_id,day) do update set checked=excluded.checked,version=habit_checks.version+1 returning * into c;
  result:=to_jsonb(c);
 elsif op in ('update','end') then
  if h.id is null or h.version is distinct from p_expected_version or h.archived_at is not null then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
  if op='end' then update worklog.habits set archived_at=now(),version=version+1 where id=p_id returning * into h;
  else update worklog.habits set name=draft->>'name',frequency=draft->>'frequency',weekdays=array(select jsonb_array_elements_text(draft->'weekdays')::integer),target=(draft->>'target')::integer,start_date=(draft->>'start_date')::date,version=version+1 where id=p_id returning * into h; end if;
  result:=to_jsonb(h);
 else raise exception 'INVALID_COMMAND'; end if;
 insert into worklog.habit_requests(request_id,habit_id,command,result) values(p_request_id,p_id,p_command,result);
 return result;
end $$;
revoke all on function worklog.mutate_habit(uuid,uuid,integer,jsonb) from public,anon;
grant execute on function worklog.mutate_habit(uuid,uuid,integer,jsonb) to authenticated;
