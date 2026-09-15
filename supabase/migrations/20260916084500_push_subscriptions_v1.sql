create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_secret text not null,
  user_agent text not null default '',
  disabled_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_length check (char_length(endpoint) between 20 and 2048),
  constraint push_subscriptions_p256dh_length check (char_length(p256dh) between 20 and 512),
  constraint push_subscriptions_auth_length check (char_length(auth_secret) between 8 and 256),
  constraint push_subscriptions_user_agent_length check (char_length(user_agent) <= 500),
  constraint push_subscriptions_user_endpoint_unique unique (user_id, endpoint)
);

create index if not exists push_subscriptions_workspace_user_idx
  on public.push_subscriptions(workspace_id, user_id)
  where disabled_at is null;

alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_select_own
  on public.push_subscriptions
  for select
  using (
    user_id = (select auth.uid())
    and (select private.can_access_workspace(push_subscriptions.workspace_id))
  );

create policy push_subscriptions_insert_own
  on public.push_subscriptions
  for insert
  with check (
    user_id = (select auth.uid())
    and (select private.can_access_workspace(push_subscriptions.workspace_id))
  );

create policy push_subscriptions_update_own
  on public.push_subscriptions
  for update
  using (
    user_id = (select auth.uid())
    and (select private.can_access_workspace(push_subscriptions.workspace_id))
  )
  with check (
    user_id = (select auth.uid())
    and (select private.can_access_workspace(push_subscriptions.workspace_id))
  );

create policy push_subscriptions_delete_own
  on public.push_subscriptions
  for delete
  using (
    user_id = (select auth.uid())
    and (select private.can_access_workspace(push_subscriptions.workspace_id))
  );

grant select, insert, update, delete on public.push_subscriptions to authenticated;
