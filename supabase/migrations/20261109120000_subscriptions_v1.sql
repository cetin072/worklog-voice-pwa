-- 내 관리 · 구독/정기결제 V1.
-- 업무(WorkRecord)·일정(Schedule)과 섞지 않는 독립 데이터. 사용자 본인 것만 보이고(RLS),
-- 삭제는 하드 DELETE 대신 archived_at 보관 처리한다(다른 기록과 같은 원칙).
-- 금액은 원(KRW) 정수. 결제일은 사용자가 입력한 '기준일'만 저장하고 다음 결제일은 앱이 계산한다.

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  amount_krw integer not null check (amount_krw > 0 and amount_krw <= 100000000),
  billing_cycle text not null check (billing_cycle in ('monthly', 'yearly')),
  scope text not null check (scope in ('business', 'personal')),
  billing_anchor_date date not null,
  cancel_deadline date,
  last_used_date date,
  -- 한 줄(말/키보드 음성) 입력으로 만든 경우 처음 입력한 문장 원문. 잘못 읽혔을 때 되돌아볼 근거.
  source_text text check (source_text is null or char_length(source_text) <= 300),
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create index subscriptions_user_active_idx
  on public.subscriptions (user_id, created_at)
  where archived_at is null;

alter table public.subscriptions enable row level security;

revoke all on table public.subscriptions from anon;
revoke all on table public.subscriptions from authenticated;
grant select, insert, update on table public.subscriptions to authenticated;

create policy subscriptions_select_owner
on public.subscriptions
for select
to authenticated
using (user_id = (select auth.uid()));

create policy subscriptions_insert_owner
on public.subscriptions
for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy subscriptions_update_owner
on public.subscriptions
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- DELETE 정책/권한을 일부러 만들지 않는다. 보관은 archived_at 갱신으로 처리한다.
