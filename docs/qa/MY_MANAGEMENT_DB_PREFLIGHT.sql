-- Read-only metadata only. Connect explicitly to project jgsxpdflgkqroecfjzxq.
-- No user rows, DDL, data mutation, or migration application.
begin read only;
set local statement_timeout = '15s';
select version, name from supabase_migrations.schema_migrations
where version in ('20261109125845','20261109144344','20261109232907','20261109233147','20261109234334') order by version;
select table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns where table_schema='worklog'
and table_name in ('subscriptions','work_records') order by table_name,ordinal_position;
select name,to_regclass('worklog.'||name)::text as existing_object from unnest(array[
 'subscription_payments','repeating_work','repeating_work_requests','habits','habit_checks','habit_requests']) name;
select signature,to_regprocedure(signature)::text as existing_function from unnest(array[
 'worklog.confirm_subscription_payment(uuid,date)','worklog.validate_repeat_revision(jsonb)',
 'worklog.repeat_occurrence_date(jsonb,text)','worklog.mutate_repeating_work(uuid,uuid,integer,jsonb)',
 'worklog.get_my_repeating_work_month(date)','worklog.guard_repeating_work_parent()',
 'worklog.mutate_habit(uuid,uuid,integer,jsonb)']) signature;
select tablename,policyname,roles,cmd,qual,with_check from pg_policies
where schemaname='worklog' and tablename in ('subscriptions','work_records') order by tablename,policyname;
select table_name,grantee,privilege_type from information_schema.role_table_grants
where table_schema='worklog' and table_name in ('subscriptions','work_records') order by table_name,grantee,privilege_type;
select tgname,pg_get_triggerdef(oid) as definition from pg_trigger
where tgrelid='worklog.work_records'::regclass and not tgisinternal order by tgname;
rollback;
