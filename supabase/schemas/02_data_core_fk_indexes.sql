-- Cover foreign keys used by ownership/history relations.

create index workspaces_owner_user_id_idx on public.workspaces(owner_user_id);
create index workspaces_created_by_user_id_idx on public.workspaces(created_by_user_id);
create index work_records_created_by_user_id_idx on public.work_records(created_by_user_id);
create index work_records_assigned_user_id_idx on public.work_records(assigned_user_id);
create index schedules_created_by_user_id_idx on public.schedules(created_by_user_id);
create index source_refs_created_by_user_id_idx on public.source_refs(created_by_user_id);
create index candidates_created_by_user_id_idx on public.candidates(created_by_user_id);
create index candidates_source_ref_id_idx on public.candidates(source_ref_id);
