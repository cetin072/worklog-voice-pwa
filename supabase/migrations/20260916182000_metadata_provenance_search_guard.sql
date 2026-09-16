-- Commercialization guard: metadata is searchable/authoritative only when its provenance
-- says the user selected or confirmed it. Legacy Notion classifications and automatic
-- client inference remain preserved as data, but are not promoted to confirmed metadata.

create or replace function public.save_my_worklog(
  p_client_request_id text,
  p_title text,
  p_content text,
  p_original_text text,
  p_record_type text,
  p_status text,
  p_institution text default null,
  p_amount numeric default null,
  p_follow_up text default null,
  p_recorded_at timestamptz default now(),
  p_due_at timestamptz default null,
  p_metadata jsonb default '{}'::jsonb,
  p_source_excerpt text default null
)
returns table (
  user_id uuid,
  workspace_id uuid,
  work_record_id uuid,
  source_ref_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
  v_work_record_id uuid;
  v_source_ref_id uuid;
  v_requested_institution_source text := lower(coalesce(
    p_metadata #>> '{fieldProvenance,institution}',
    p_metadata #>> '{field_provenance,institution}',
    p_metadata ->> 'institutionSource',
    p_metadata ->> 'institution_source',
    ''
  ));
  v_institution_source text;
  v_institution text;
  v_metadata jsonb;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  if p_client_request_id is null
    or char_length(btrim(p_client_request_id)) < 16
    or char_length(btrim(p_client_request_id)) > 100 then
    raise exception 'CLIENT_REQUEST_ID_INVALID';
  end if;

  v_institution_source := case
    when nullif(btrim(coalesce(p_institution, '')), '') is null then 'unset'
    when v_requested_institution_source in ('user_selected', 'user_confirmed') then v_requested_institution_source
    else 'unverified'
  end;

  v_institution := case
    when v_institution_source in ('user_selected', 'user_confirmed')
      then nullif(btrim(coalesce(p_institution, '')), '')
    else null
  end;

  v_metadata := coalesce(p_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'fieldProvenance',
      coalesce(p_metadata -> 'fieldProvenance', '{}'::jsonb)
        || jsonb_build_object('institution', v_institution_source)
    );

  select w.id
  into v_workspace_id
  from public.workspaces w
  where w.owner_user_id = v_user_id
    and w.kind = 'personal'
  order by w.created_at asc
  limit 1;

  if v_workspace_id is null then
    raise exception 'PERSONAL_WORKSPACE_MISSING';
  end if;

  insert into public.work_records (
    workspace_id,
    created_by_user_id,
    client_request_id,
    title,
    content,
    original_text,
    record_type,
    status,
    institution,
    amount,
    follow_up,
    recorded_at,
    due_at,
    metadata
  ) values (
    v_workspace_id,
    v_user_id,
    btrim(p_client_request_id),
    p_title,
    coalesce(p_content, ''),
    coalesce(p_original_text, ''),
    p_record_type,
    p_status,
    v_institution,
    p_amount,
    nullif(btrim(coalesce(p_follow_up, '')), ''),
    p_recorded_at,
    p_due_at,
    v_metadata
  )
  on conflict on constraint work_records_workspace_client_request_id_key
  do update set
    title = excluded.title,
    content = excluded.content,
    original_text = excluded.original_text,
    record_type = excluded.record_type,
    status = excluded.status,
    institution = excluded.institution,
    amount = excluded.amount,
    follow_up = excluded.follow_up,
    recorded_at = excluded.recorded_at,
    due_at = excluded.due_at,
    metadata = excluded.metadata
  returning id into v_work_record_id;

  insert into public.source_refs (
    workspace_id,
    created_by_user_id,
    client_request_id,
    entity_type,
    entity_id,
    source_type,
    source_id,
    source_excerpt,
    metadata
  ) values (
    v_workspace_id,
    v_user_id,
    btrim(p_client_request_id),
    'work_record',
    v_work_record_id::text,
    'direct',
    btrim(p_client_request_id),
    p_source_excerpt,
    jsonb_build_object(
      'source', 'quick_worklog',
      'fieldProvenance', jsonb_build_object('institution', v_institution_source)
    )
  )
  on conflict on constraint source_refs_workspace_client_request_id_key
  do update set
    entity_type = excluded.entity_type,
    entity_id = excluded.entity_id,
    source_type = excluded.source_type,
    source_id = excluded.source_id,
    source_excerpt = excluded.source_excerpt,
    metadata = excluded.metadata
  returning id into v_source_ref_id;

  return query
  select v_user_id, v_workspace_id, v_work_record_id, v_source_ref_id;
end;
$$;

revoke all on function public.save_my_worklog(text, text, text, text, text, text, text, numeric, text, timestamptz, timestamptz, jsonb, text) from public, anon;
grant execute on function public.save_my_worklog(text, text, text, text, text, text, text, numeric, text, timestamptz, timestamptz, jsonb, text) to authenticated, service_role;

create or replace function public.search_my_work_records(
  p_query text,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  work_record_id uuid,
  workspace_id uuid,
  workspace_name text,
  title text,
  snippet text,
  institution text,
  record_type text,
  status text,
  recorded_at timestamptz,
  due_at timestamptz,
  match_type text,
  match_rank integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with input as (
    select nullif(btrim(p_query), '') as raw_q
  ),
  params as (
    select
      case when raw_q is not null and char_length(raw_q) <= 120 then raw_q end as q,
      case when raw_q is not null and char_length(raw_q) <= 120 then lower(raw_q) end as q_lower,
      case when raw_q is not null and char_length(raw_q) <= 120 then
        '%' || replace(
          replace(
            replace(raw_q, chr(92), chr(92) || chr(92)),
            '%', chr(92) || '%'
          ),
          '_', chr(92) || '_'
        ) || '%'
      end as pattern,
      greatest(1, least(coalesce(p_limit, 20), 50)) as page_limit,
      greatest(0, least(coalesce(p_offset, 0), 5000)) as page_offset
    from input
  ),
  searchable as (
    select
      wr.id as work_record_id,
      wr.workspace_id,
      w.name as workspace_name,
      wr.title,
      wr.content,
      wr.original_text,
      wr.follow_up,
      wr.record_type,
      wr.status,
      wr.recorded_at,
      wr.due_at,
      n.normalized_title,
      n.normalized_text,
      case when lower(coalesce(
        wr.metadata #>> '{fieldProvenance,institution}',
        wr.metadata #>> '{field_provenance,institution}',
        wr.metadata ->> 'institutionSource',
        wr.metadata ->> 'institution_source',
        n.structured_data #>> '{provenance,institution}',
        ''
      )) in ('user_selected', 'user_confirmed')
        then coalesce(wr.institution, n.structured_data ->> 'institution', '')
        else ''
      end as trusted_institution,
      concat_ws(' ',
        case when lower(coalesce(
          wr.metadata #>> '{fieldProvenance,project}',
          n.structured_data #>> '{provenance,project}',
          ''
        )) in ('user_selected', 'user_confirmed')
          then coalesce(n.structured_data ->> 'project', n.structured_data ->> 'project_name', '')
          else ''
        end,
        case when lower(coalesce(
          wr.metadata #>> '{fieldProvenance,person}',
          n.structured_data #>> '{provenance,person}',
          ''
        )) in ('user_selected', 'user_confirmed')
          then concat_ws(' ', n.structured_data ->> 'person', n.structured_data ->> 'people')
          else ''
        end,
        case when lower(coalesce(
          wr.metadata #>> '{fieldProvenance,contact}',
          n.structured_data #>> '{provenance,contact}',
          ''
        )) in ('user_selected', 'user_confirmed')
          then coalesce(n.structured_data ->> 'contact', '')
          else ''
        end,
        case when lower(coalesce(
          wr.metadata #>> '{fieldProvenance,keywords}',
          n.structured_data #>> '{provenance,keywords}',
          ''
        )) in ('user_selected', 'user_confirmed')
          then coalesce(n.structured_data ->> 'keywords', '')
          else ''
        end
      ) as trusted_structured_text,
      case when lower(coalesce(
        wr.metadata #>> '{fieldProvenance,searchAliases}',
        n.structured_data #>> '{provenance,searchAliases}',
        ''
      )) in ('user_selected', 'user_confirmed')
        then coalesce(n.search_aliases, '{}'::text[])
        else '{}'::text[]
      end as trusted_aliases,
      p.q,
      p.q_lower,
      p.pattern
    from public.work_records wr
    join public.workspaces w on w.id = wr.workspace_id
    left join public.work_record_normalizations n
      on n.work_record_id = wr.id
      and n.workspace_id = wr.workspace_id
    cross join params p
    where p.q is not null
  ),
  candidates as (
    select
      s.*,
      case
        when
          lower(btrim(coalesce(s.title, ''))) = s.q_lower
          or lower(btrim(coalesce(s.content, ''))) = s.q_lower
          or lower(btrim(coalesce(s.trusted_institution, ''))) = s.q_lower
          or lower(btrim(coalesce(s.normalized_title, ''))) = s.q_lower
          or lower(btrim(coalesce(s.normalized_text, ''))) = s.q_lower
          then 0
        when
          (
            coalesce(s.title, '') || ' ' ||
            coalesce(s.content, '') || ' ' ||
            coalesce(s.trusted_institution, '') || ' ' ||
            coalesce(s.follow_up, '')
          ) ilike s.pattern
          or (
            coalesce(s.normalized_title, '') || ' ' ||
            coalesce(s.normalized_text, '') || ' ' ||
            coalesce(s.trusted_structured_text, '')
          ) ilike s.pattern
          then 1
        when
          s.trusted_aliases @> array[s.q]::text[]
          or exists (
            select 1
            from unnest(s.trusted_aliases) as alias_value(value)
            where lower(btrim(alias_value.value)) = s.q_lower
          )
          then 2
        when coalesce(s.original_text, '') ilike s.pattern then 3
        else 9
      end as match_rank
    from searchable s
    where
      lower(btrim(coalesce(s.title, ''))) = s.q_lower
      or lower(btrim(coalesce(s.content, ''))) = s.q_lower
      or lower(btrim(coalesce(s.trusted_institution, ''))) = s.q_lower
      or lower(btrim(coalesce(s.normalized_title, ''))) = s.q_lower
      or lower(btrim(coalesce(s.normalized_text, ''))) = s.q_lower
      or (
        coalesce(s.title, '') || ' ' ||
        coalesce(s.content, '') || ' ' ||
        coalesce(s.original_text, '') || ' ' ||
        coalesce(s.trusted_institution, '') || ' ' ||
        coalesce(s.follow_up, '')
      ) ilike s.pattern
      or (
        coalesce(s.normalized_title, '') || ' ' ||
        coalesce(s.normalized_text, '') || ' ' ||
        coalesce(s.trusted_structured_text, '')
      ) ilike s.pattern
      or s.trusted_aliases @> array[s.q]::text[]
      or exists (
        select 1
        from unnest(s.trusted_aliases) as alias_value(value)
        where lower(btrim(alias_value.value)) = s.q_lower
      )
  ),
  ranked as (
    select
      c.*,
      row_number() over (
        partition by
          c.workspace_id,
          case
            when nullif(c.original_text, '') is not null then 'raw:' || c.original_text
            else 'id:' || c.work_record_id::text
          end
        order by c.match_rank asc, c.recorded_at desc, c.work_record_id
      ) as source_group_row
    from candidates c
    where c.match_rank < 9
  )
  select
    r.work_record_id,
    r.workspace_id,
    r.workspace_name,
    r.title,
    case
      when r.match_rank = 3 then
        substring(
          r.original_text
          from greatest(1, strpos(lower(r.original_text), r.q_lower) - 80)
          for 280
        )
      else left(
        coalesce(
          nullif(r.content, ''),
          nullif(r.normalized_text, ''),
          nullif(r.original_text, ''),
          r.title
        ),
        280
      )
    end as snippet,
    nullif(r.trusted_institution, '') as institution,
    r.record_type,
    r.status,
    r.recorded_at,
    r.due_at,
    case r.match_rank
      when 0 then 'exact'
      when 1 then 'partial'
      when 2 then 'alias'
      when 3 then 'partial'
      else 'unknown'
    end as match_type,
    r.match_rank
  from ranked r
  cross join params p
  where r.match_rank < 3
     or (r.match_rank = 3 and r.source_group_row = 1)
  order by r.match_rank asc, r.recorded_at desc, r.work_record_id
  limit (select page_limit from params)
  offset (select page_offset from params);
$$;

revoke all on function public.search_my_work_records(text, integer, integer) from public, anon;
grant execute on function public.search_my_work_records(text, integer, integer) to authenticated, service_role;
