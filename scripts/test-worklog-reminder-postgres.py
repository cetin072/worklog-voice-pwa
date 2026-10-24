"""Isolated SQL contract test. Requires the already-pulled postgres:17-alpine image.
No ports, credentials or network; no connection to a Supabase project.
"""
import subprocess, pathlib, time, uuid
ROOT = pathlib.Path(__file__).resolve().parents[1]
NAME = 'worklog-reminder-test-' + uuid.uuid4().hex[:8]
IMAGE = 'postgres@sha256:eee6c6e1b0894fa4fe0075eb054af9fd1cf39a35321c2d4110626cfe506411fb'
UID = '11111111-1111-4111-8111-111111111111'
OTHER = '22222222-2222-4222-8222-222222222222'
WID = '33333333-3333-4333-8333-333333333333'
RID = '44444444-4444-4444-8444-444444444444'
WHEN = '2099-01-01T09:00:00+09:00'

def command(): return ['docker','exec','-e','PGOPTIONS=-c statement_timeout=10000 -c lock_timeout=5000','-i',NAME,'psql','-X','-U','postgres','-At','-v','ON_ERROR_STOP=1']
def sql(value, expected=None):
    result = subprocess.run(command(), input=value, text=True, capture_output=True, timeout=30)
    if expected:
        assert result.returncode and expected in result.stderr, result.stderr
    else:
        assert result.returncode == 0, result.stderr
    return result.stdout.strip()
def owner(value, uid=UID): return f"set role authenticated; set request.jwt.claim.sub='{uid}'; {value}"
def confirm(): return f"select * from public.confirm_my_worklog_reminder('{RID}','{WHEN}');"
def cancel(): return f"select * from public.cancel_my_work_record('{RID}');"
def reset():
    sql(f"delete from public.schedules; update public.work_records set status='in_progress' where id='{RID}';")
def race(first, second, second_error=None):
    reset()
    # Lock acquisition is observed before starting the second operation; no timing guess.
    lock = f"begin; set role authenticated; set request.jwt.claim.sub='{UID}'; select id from work_records where id='{RID}' for update; select 'LOCKED'; select pg_sleep(0.4); {first} commit;"
    proc = subprocess.Popen(command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    proc.stdin.write(lock); proc.stdin.close()
    while True:
        line = proc.stdout.readline()
        assert line, 'first transaction failed before lock'
        if line.strip() == 'LOCKED': break
    sql(owner(second),second_error)
    proc.wait(timeout=10)
    assert proc.returncode == 0, proc.stderr.read()
    assert sql("select count(*) from schedules where status='confirmed';") == '0'
try:
    subprocess.run(['docker','run','--pull=never','-d','--rm','--name',NAME,'--network','none','-e','POSTGRES_HOST_AUTH_METHOD=trust',IMAGE],check=True,capture_output=True)
    for _ in range(100):
        initialized = 'init process complete' in subprocess.run(['docker','logs',NAME],capture_output=True,text=True).stdout
        if initialized and subprocess.run(['docker','exec',NAME,'pg_isready','-U','postgres'],capture_output=True).returncode == 0: break
        time.sleep(.1)
    sql("create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;")
    # Existing declarative snapshot has single-$ delimiters. Normalize only the
    # isolated fixture; do not modify the repository schema or live database.
    schema = (ROOT/'supabase/schemas/01_data_core_v1.sql').read_text().replace('\nas $\n','\nas $$\n').replace('\n$;','\n$$;')
    sql(schema)
    sql((ROOT/'supabase/migrations/20260922103000_work_record_soft_delete_v1.sql').read_text())
    acl_query = "select proacl::text from pg_proc where oid='public.cancel_my_work_record(uuid)'::regprocedure;"
    before_acl = sql(acl_query)
    sql((ROOT/'supabase/drafts/worklog_reminder_confirmation.sql').read_text())
    assert sql(acl_query) == before_acl, 'existing cancellation EXECUTE ACL changed'
    sql(f"insert into auth.users values('{UID}'),('{OTHER}'); insert into workspaces(id,name,owner_user_id,created_by_user_id) values('{WID}','test','{UID}','{UID}'); insert into work_records(id,workspace_id,created_by_user_id,title,action_kind,journal_date) values('{RID}','{WID}','{UID}','진주IC','note','2026-10-24');")
    sql(owner(confirm(), OTHER), 'WORK_RECORD_NOT_FOUND_OR_FORBIDDEN')
    sql(owner(confirm())); sql(owner(confirm()))
    assert sql('select count(*) from schedules;') == '1'
    assert sql(f"select action_kind || ':' || coalesce(due_at::text,'none') from work_records where id='{RID}';") == 'note:none'
    assert sql("select count(*) from schedules where metadata ? 'workRecordId';") == '0'
    sql(owner(confirm().replace(WHEN,'2099-01-02T09:00:00+09:00')), 'REMINDER_TIME_CONFLICT')
    sql(owner(cancel())); sql(owner(confirm()),'WORK_RECORD_INACTIVE')
    reset(); sql(owner(confirm().replace(WHEN,'2000-01-01T09:00:00+09:00')),'TIME_INVALID')
    assert sql('select count(*) from schedules;') == '0'
    sql(f"update work_records set status='completed' where id='{RID}';")
    sql(owner(confirm()),'WORK_RECORD_INACTIVE')
    reset(); sql(owner(confirm()))
    sql('revoke execute on function public.confirm_my_worklog_reminder(uuid,timestamptz) from authenticated, public, anon;')
    sql(owner(confirm()), 'permission denied')
    assert sql('select count(*) from schedules;') == '1'
    sql(owner(cancel()))
    assert sql("select count(*) from schedules where status='confirmed';") == '0'
    assert sql('select count(*) from work_records;') == '1'
    sql('grant execute on function public.confirm_my_worklog_reminder(uuid,timestamptz) to authenticated;')
    race(confirm(), cancel())
    race(cancel(), confirm(), 'WORK_RECORD_INACTIVE')
    print('PASS: PostgreSQL 17 owner, duplicate, conflict, preserved note/deadline, past, completed, cancellation, preserving rollback and both lock orders')
finally:
    subprocess.run(['docker','rm','-f',NAME],capture_output=True)
