-- Issue #131: a Quick Worklog client request must converge to one Data Core
-- record and one source reference, even when a network retry occurs after a
-- partial Notion/Data Core write.

alter table public.work_records
add column client_request_id text;

alter table public.work_records
add constraint work_records_client_request_id_format_check
check (client_request_id is null or char_length(client_request_id) between 16 and 100);

alter table public.work_records
add constraint work_records_workspace_client_request_id_key
unique (workspace_id, client_request_id);

alter table public.source_refs
add column client_request_id text;

alter table public.source_refs
add constraint source_refs_client_request_id_format_check
check (client_request_id is null or char_length(client_request_id) between 16 and 100);

alter table public.source_refs
add constraint source_refs_workspace_client_request_id_key
unique (workspace_id, client_request_id);
