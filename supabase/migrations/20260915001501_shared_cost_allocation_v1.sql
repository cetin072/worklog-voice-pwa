-- Issue #160: monthly shared infrastructure cost pools and per-user/workspace allocations.
-- Direct variable cost remains in usage_events; shared cost is stored separately.

create table public.shared_cost_pools (
  id uuid primary key default gen_random_uuid(),
  month_start date not null,
  cost_key text not null,
  provider text not null,
  category text not null,
  amount_krw numeric(20,6) not null,
  allocation_method text not null default 'equal_active_user',
  source_note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shared_cost_pools_month_start_check check (month_start = date_trunc('month', month_start::timestamp)::date),
  constraint shared_cost_pools_cost_key_length check (char_length(cost_key) between 1 and 120),
  constraint shared_cost_pools_provider_length check (char_length(provider) between 1 and 80),
  constraint shared_cost_pools_category_check check (category in ('database','hosting','domain','storage','network','observability','other')),
  constraint shared_cost_pools_amount_nonnegative check (amount_krw >= 0),
  constraint shared_cost_pools_allocation_method_check check (allocation_method in ('equal_active_user')),
  constraint shared_cost_pools_source_note_length check (source_note is null or char_length(source_note) <= 1000),
  constraint shared_cost_pools_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint shared_cost_pools_month_key_unique unique (month_start, cost_key)
);

create trigger shared_cost_pools_set_updated_at
before update on public.shared_cost_pools
for each row execute function private.set_updated_at();

create table public.shared_cost_allocations (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references public.shared_cost_pools(id) on delete cascade,
  month_start date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  allocation_method text not null,
  allocation_weight numeric(20,12) not null,
  allocated_cost_krw numeric(20,6) not null,
  created_at timestamptz not null default now(),
  constraint shared_cost_allocations_month_start_check check (month_start = date_trunc('month', month_start::timestamp)::date),
  constraint shared_cost_allocations_method_check check (allocation_method in ('equal_active_user')),
  constraint shared_cost_allocations_weight_check check (allocation_weight > 0 and allocation_weight <= 1),
  constraint shared_cost_allocations_cost_nonnegative check (allocated_cost_krw >= 0),
  constraint shared_cost_allocations_unique unique (pool_id, user_id, workspace_id)
);

create index shared_cost_allocations_user_month_idx
  on public.shared_cost_allocations (user_id, month_start desc);
create index shared_cost_allocations_workspace_month_idx
  on public.shared_cost_allocations (workspace_id, month_start desc);

alter table public.shared_cost_pools enable row level security;
alter table public.shared_cost_allocations enable row level security;

create policy shared_cost_allocations_select_own
on public.shared_cost_allocations
for select
to authenticated
using (
  user_id = (select auth.uid())
  and private.can_access_workspace(workspace_id)
);

revoke all on table public.shared_cost_pools from public, anon, authenticated;
grant select, insert, update, delete on table public.shared_cost_pools to service_role;

revoke all on table public.shared_cost_allocations from public, anon, authenticated;
grant select on table public.shared_cost_allocations to authenticated;
grant select, insert, update, delete on table public.shared_cost_allocations to service_role;

create or replace function public.recalculate_shared_cost_allocations(p_month_start date)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_month_end date;
  v_inserted integer := 0;
begin
  if p_month_start is null
     or p_month_start <> date_trunc('month', p_month_start::timestamp)::date then
    raise exception 'SHARED_COST_MONTH_START_INVALID';
  end if;

  v_month_end := (p_month_start + interval '1 month')::date;

  delete from public.shared_cost_allocations
  where month_start = p_month_start;

  with active_pairs as (
    select distinct x.user_id, x.workspace_id
    from (
      select ue.user_id, ue.workspace_id
      from public.usage_events ue
      where ue.created_at >= p_month_start
        and ue.created_at < v_month_end

      union all

      select wr.created_by_user_id, wr.workspace_id
      from public.work_records wr
      where wr.created_by_user_id is not null
        and wr.created_at >= p_month_start
        and wr.created_at < v_month_end

      union all

      select s.created_by_user_id, s.workspace_id
      from public.schedules s
      where s.created_by_user_id is not null
        and s.created_at >= p_month_start
        and s.created_at < v_month_end

      union all

      select sr.created_by_user_id, sr.workspace_id
      from public.source_refs sr
      where sr.created_by_user_id is not null
        and sr.created_at >= p_month_start
        and sr.created_at < v_month_end

      union all

      select c.created_by_user_id, c.workspace_id
      from public.candidates c
      where c.created_by_user_id is not null
        and c.created_at >= p_month_start
        and c.created_at < v_month_end
    ) x
    where x.user_id is not null
  ),
  active_count as (
    select count(*)::numeric as n from active_pairs
  )
  insert into public.shared_cost_allocations (
    pool_id,
    month_start,
    user_id,
    workspace_id,
    allocation_method,
    allocation_weight,
    allocated_cost_krw
  )
  select
    p.id,
    p.month_start,
    a.user_id,
    a.workspace_id,
    p.allocation_method,
    (1 / c.n)::numeric(20,12),
    round((p.amount_krw / c.n)::numeric, 6)::numeric(20,6)
  from public.shared_cost_pools p
  cross join active_pairs a
  cross join active_count c
  where p.month_start = p_month_start
    and p.allocation_method = 'equal_active_user'
    and c.n > 0;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.recalculate_shared_cost_allocations(date) from public, anon, authenticated;
grant execute on function public.recalculate_shared_cost_allocations(date) to service_role;

create or replace view public.user_monthly_cost
with (security_invoker = true)
as
with shared as (
  select
    month_start,
    user_id,
    workspace_id,
    sum(allocated_cost_krw)::numeric(20,6) as allocated_shared_cost_krw
  from public.shared_cost_allocations
  group by month_start, user_id, workspace_id
)
select
  coalesce(d.month_start, s.month_start) as month_start,
  coalesce(d.user_id, s.user_id) as user_id,
  coalesce(d.workspace_id, s.workspace_id) as workspace_id,
  coalesce(d.event_count, 0)::bigint as event_count,
  coalesce(d.audio_seconds, 0)::numeric(20,3) as audio_seconds,
  coalesce(d.input_tokens, 0)::bigint as input_tokens,
  coalesce(d.output_tokens, 0)::bigint as output_tokens,
  coalesce(d.storage_bytes, 0)::bigint as storage_bytes,
  coalesce(d.api_calls, 0)::bigint as api_calls,
  coalesce(d.direct_cost_krw, 0)::numeric(20,6) as direct_cost_krw,
  coalesce(s.allocated_shared_cost_krw, 0)::numeric(20,6) as allocated_shared_cost_krw,
  (coalesce(d.direct_cost_krw, 0) + coalesce(s.allocated_shared_cost_krw, 0))::numeric(20,6) as total_cost_krw
from public.usage_monthly_direct_cost d
full outer join shared s
  on s.month_start = d.month_start
 and s.user_id = d.user_id
 and s.workspace_id = d.workspace_id;

revoke all on table public.user_monthly_cost from public, anon, authenticated;
grant select on table public.user_monthly_cost to authenticated, service_role;

comment on table public.shared_cost_pools is 'Monthly shared infrastructure cost pools; trusted server/admin only.';
comment on table public.shared_cost_allocations is 'Derived per-user/workspace shared cost allocations. Authenticated users can read only their own rows.';
comment on view public.user_monthly_cost is 'Monthly direct + allocated shared + total cost per user/workspace.';
