-- Issue #327: shared schedule defer + 30-minute reminder foundation.
-- Additive only. Production application requires explicit approval.

create table if not exists public.schedule_defer_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  changed_by_user_id uuid not null references auth.users(id),
  previous_starts_at timestamptz not null,
  previous_ends_at timestamptz,
  new_starts_at timestamptz not null,
  new_ends_at timestamptz,
  preset text not null check (preset in ('day','week','fortnight','month','custom')),
  created_at timestamptz not null default now()
);

alter table public.schedule_defer_history enable row level security;
create policy schedule_defer_history_select on public.schedule_defer_history for select to authenticated using (changed_by_user_id = (select auth.uid()));

create or replace function public.defer_my_schedule(p_schedule_id uuid, p_new_starts_at timestamptz, p_preset text)
returns table(schedule_id uuid, starts_at timestamptz, ends_at timestamptz, reminder_at timestamptz)
language plpgsql security invoker set search_path = '' as $$
declare
  v public.schedules%rowtype;
  v_duration interval;
begin
  if (select auth.uid()) is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  if p_schedule_id is null or p_new_starts_at is null then raise exception 'SCHEDULE_DEFER_INPUT_REQUIRED' using errcode='22023'; end if;
  if p_preset not in ('day','week','fortnight','month','custom') then raise exception 'SCHEDULE_DEFER_PRESET_INVALID' using errcode='22023'; end if;
  select s.* into v from public.schedules s where s.id=p_schedule_id and s.created_by_user_id=(select auth.uid()) for update;
  if not found then raise exception 'SCHEDULE_NOT_FOUND_OR_FORBIDDEN' using errcode='P0002'; end if;
  if v.status not in ('confirmed','tentative') then raise exception 'SCHEDULE_DEFER_STATUS_INVALID' using errcode='55000'; end if;
  v_duration := case when v.ends_at is null then null else v.ends_at-v.starts_at end;
  insert into public.schedule_defer_history(workspace_id,schedule_id,changed_by_user_id,previous_starts_at,previous_ends_at,new_starts_at,new_ends_at,preset)
  values(v.workspace_id,v.id,(select auth.uid()),v.starts_at,v.ends_at,p_new_starts_at,case when v_duration is null then null else p_new_starts_at+v_duration end,p_preset);
  update public.schedules s set starts_at=p_new_starts_at, ends_at=case when v_duration is null then null else p_new_starts_at+v_duration end,
    reminder_at=case when v.all_day then null else p_new_starts_at-interval '30 minutes' end, updated_at=now()
  where s.id=v.id;
  return query select s.id,s.starts_at,s.ends_at,s.reminder_at from public.schedules s where s.id=v.id;
end; $$;

revoke all on function public.defer_my_schedule(uuid,timestamptz,text) from public, anon;
grant execute on function public.defer_my_schedule(uuid,timestamptz,text) to authenticated;
