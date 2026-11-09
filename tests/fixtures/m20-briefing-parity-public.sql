-- Disposable PGlite fixture, never run against hosted Supabase.
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

create table public.workspaces (
  id uuid primary key, owner_user_id uuid not null, kind text not null,
  created_at timestamptz default now()
);
create table public.work_records (
  id uuid primary key, workspace_id uuid not null, created_by_user_id uuid not null,
  title text, institution text, status text not null, follow_up text,
  due_at timestamptz, updated_at timestamptz default now(),
  recorded_at timestamptz default now(), metadata jsonb default '{}'::jsonb,
  action_kind text, journal_date date, briefing_state text
);
create table public.schedules (
  id uuid primary key, workspace_id uuid not null, created_by_user_id uuid not null,
  title text, starts_at timestamptz, all_day boolean default false,
  status text not null, location text, metadata jsonb default '{}'::jsonb
);
grant select on public.workspaces,public.work_records,public.schedules to authenticated;
alter table public.workspaces enable row level security;
alter table public.work_records enable row level security;
alter table public.schedules enable row level security;
create policy own_workspaces on public.workspaces for select to authenticated
  using (owner_user_id=(select auth.uid()));
create policy own_records on public.work_records for select to authenticated
  using (created_by_user_id=(select auth.uid()) and workspace_id in
    (select id from public.workspaces where owner_user_id=(select auth.uid())));
create policy own_schedules on public.schedules for select to authenticated
  using (created_by_user_id=(select auth.uid()) and workspace_id in
    (select id from public.workspaces where owner_user_id=(select auth.uid())));

insert into public.workspaces(id,owner_user_id,kind) values
  ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','personal'),
  ('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','personal');
insert into public.work_records(id,workspace_id,created_by_user_id,title,status,action_kind,metadata,journal_date,briefing_state) values
 ('55555555-5555-4555-8555-555555555555','33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','Ordinary Task','in_progress','task','{}','2026-11-08','active'),
 ('66666666-6666-4666-8666-666666666666','33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','Legacy Task','waiting',null,'{}','2026-11-08','active'),
 ('77777777-7777-4777-8777-777777777777','33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','Meeting source','in_progress',null,'{"actionEngine":{"kind":"schedule"}}','2026-11-08','active'),
 ('88888888-8888-4888-8888-888888888888','33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','Linked source','in_progress',null,'{}','2026-11-08','active'),
 ('99999999-9999-4999-8999-999999999999','33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','Cancelled link task','in_progress','task','{}','2026-11-08','active'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','Reference Note','in_progress','note','{}','2026-11-08','active'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','Other account Task','in_progress','task','{}','2026-11-08','active');
insert into public.schedules(id,workspace_id,created_by_user_id,title,starts_at,status,metadata) values
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','Linked confirmed',now()+interval '1 hour','confirmed','{"workRecordId":"88888888-8888-4888-8888-888888888888"}'),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','Cancelled schedule',now()+interval '1 hour','cancelled','{"workRecordId":"99999999-9999-4999-8999-999999999999"}'),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','Confirmed meeting',now()+interval '1 hour','confirmed','{"workRecordId":"77777777-7777-4777-8777-777777777777"}');
-- 501 newer Schedule source records must not evict a real Task from the first 500.
insert into public.work_records(id,workspace_id,created_by_user_id,title,status,action_kind,metadata,updated_at)
select gen_random_uuid(),'33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',
 'Schedule-only source '||n,'in_progress',null,'{"actionEngine":{"kind":"schedule"}}'::jsonb,now()+interval '1 hour'
from generate_series(1,501) n;
