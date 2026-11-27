alter table worklog.work_documents add column deleted_at timestamptz;

-- Existing lists, direct reads and edits all use the same owner policy.
alter policy work_documents_owner on worklog.work_documents
  using (user_id = (select auth.uid()) and deleted_at is null)
  with check (user_id = (select auth.uid()) and deleted_at is null);

-- This RPC can change visibility while table access stays limited to active documents.
create function worklog.set_my_work_document_deleted(
  p_owner uuid, p_id uuid, p_version integer, p_deleted boolean
) returns integer
language plpgsql security definer set search_path = '' as $$
declare next_version integer;
begin
  if p_owner is null or p_owner is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'Wrong document owner';
  end if;
  if p_id is null or p_version is null or p_version < 0 or p_deleted is null then
    raise exception using errcode = '22023', message = 'Invalid document deletion request';
  end if;

  update worklog.work_documents d
  set deleted_at = case when p_deleted then clock_timestamp() else null end,
      version = d.version + 1, updated_at = clock_timestamp()
  where d.id = p_id and d.user_id = p_owner and d.version = p_version
    and (d.deleted_at is not null) <> p_deleted
  returning d.version into next_version;

  if next_version is null then
    -- A connection can fail after commit. Retrying the same operation is safe.
    select d.version into next_version from worklog.work_documents d
    where d.id = p_id and d.user_id = p_owner and d.version = p_version + 1
      and (d.deleted_at is not null) = p_deleted;
  end if;
  if next_version is null then
    raise exception using errcode = 'PT409', message = 'Work document changed';
  end if;
  return next_version;
end;
$$;

revoke all on function worklog.set_my_work_document_deleted(uuid,uuid,integer,boolean)
  from public, anon, authenticated;
grant execute on function worklog.set_my_work_document_deleted(uuid,uuid,integer,boolean)
  to authenticated;
