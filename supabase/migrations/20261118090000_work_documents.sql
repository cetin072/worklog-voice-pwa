-- Personal Markdown documents are independent of short records, deadlines, and reminders.
create table worklog.work_documents (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  folder_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  body text not null check (char_length(btrim(body)) > 0 and octet_length(body) <= 1048576),
  version integer not null default 0 check (version >= 0),
  updated_at timestamptz not null default now(),
  foreign key(folder_id, user_id) references worklog.work_folders(id, user_id)
);
create index work_documents_owner_updated on worklog.work_documents(user_id, updated_at desc, id);
alter table worklog.work_documents enable row level security;
revoke all on worklog.work_documents from public, anon, authenticated;
grant select, insert, update on worklog.work_documents to authenticated;
create policy work_documents_owner on worklog.work_documents for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- List responses never send entire document bodies.
create function worklog.list_my_work_documents(p_owner uuid, p_all boolean, p_folder uuid, p_query text, p_offset integer)
returns table(id uuid, folder_id uuid, title text, preview text, updated_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  with recursive folders(id) as (
    select f.id from worklog.work_folders f where f.user_id = (select auth.uid()) and f.id = p_folder
    union
    select f.id from worklog.work_folders f join folders parent on f.parent_id = parent.id
    where f.user_id = (select auth.uid())
  ), search(term) as (select lower(btrim(left(coalesce(p_query, ''), 160))))
  select d.id, d.folder_id, d.title,
    substring(d.body from greatest(1, strpos(lower(d.body), search.term) - 30) for 160),
    d.updated_at
  from worklog.work_documents d cross join search
  where d.user_id = (select auth.uid()) and d.user_id = p_owner
    and (p_all or (p_folder is null and d.folder_id is null) or d.folder_id in (select folders.id from folders))
    and (search.term = '' or strpos(lower(d.title), search.term) > 0 or strpos(lower(d.body), search.term) > 0)
  order by d.updated_at desc, d.id limit 26 offset greatest(0, coalesce(p_offset, 0));
$$;

create function worklog.save_my_work_document(
  p_owner uuid, p_id uuid, p_version integer, p_title text, p_body text, p_folder uuid
) returns worklog.work_documents
language plpgsql security invoker set search_path = '' as $$
declare saved worklog.work_documents;
begin
  if p_owner is null or p_owner is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'Wrong document owner';
  end if;
  if p_version = -1 then
    insert into worklog.work_documents(id, title, body, folder_id)
    values(p_id, btrim(p_title), p_body, p_folder)
    on conflict (id) do nothing returning * into saved;
  else
    update worklog.work_documents d
      set title = btrim(p_title), body = p_body, folder_id = p_folder,
          version = d.version + 1, updated_at = clock_timestamp()
    where d.id = p_id and d.user_id = p_owner and d.version = p_version
    returning * into saved;
  end if;
  if saved.id is null then
    -- A response may have been lost after commit. An exact retry is safe.
    select * into saved from worklog.work_documents d
    where d.id = p_id and d.user_id = p_owner and d.version = p_version + 1
      and d.title = btrim(p_title) and d.body = p_body
      and d.folder_id is not distinct from p_folder;
  end if;
  if saved.id is null then
    raise exception using errcode = 'PT409', message = 'Work document changed';
  end if;
  return saved;
end;
$$;

revoke all on function worklog.list_my_work_documents(uuid,boolean,uuid,text,integer),
  worklog.save_my_work_document(uuid,uuid,integer,text,text,uuid) from public, anon;
grant execute on function worklog.list_my_work_documents(uuid,boolean,uuid,text,integer),
  worklog.save_my_work_document(uuid,uuid,integer,text,text,uuid) to authenticated;
