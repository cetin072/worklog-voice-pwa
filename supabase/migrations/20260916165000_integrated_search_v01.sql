-- Issue #255: Integrated Search 0.1
-- Server-side bounded keyword search over WorkRecord raw + normalized fields.
-- No vector/embedding/LLM dependency. SECURITY INVOKER preserves existing RLS.

create extension if not exists pg_trgm with schema extensions;

create index if not exists work_records_search_text_trgm_idx
on public.work_records using gin ((
  coalesce(title, '') || ' ' ||
  coalesce(content, '') || ' ' ||
  coalesce(original_text, '') || ' ' ||
  coalesce(institution, '') || ' ' ||
  coalesce(follow_up, '')
) extensions.gin_trgm_ops);

create index if not exists work_record_normalizations_search_text_trgm_idx
on public.work_record_normalizations using gin ((
  coalesce(normalized_title, '') || ' ' ||
  coalesce(normalized_text, '') || ' ' ||
  coalesce(structured_data ->> 'institution', '') || ' ' ||
  coalesce(structured_data ->> 'project', '') || ' ' ||
  coalesce(structured_data ->> 'project_name', '') || ' ' ||
  coalesce(structured_data ->> 'person', '') || ' ' ||
  coalesce(structured_data ->> 'people', '') || ' ' ||
  coalesce(structured_data ->> 'contact', '') || ' ' ||
  coalesce(structured_data ->> 'keywords', '')
) extensions.gin_trgm_ops);

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
  with params as (
    select
      nullif(btrim(p_query), '') as q,
      lower(nullif(btrim(p_query), '')) as q_lower,
      '%' || replace(
        replace(
          replace(nullif(btrim(p_query), ''), chr(92), chr(92) || chr(92)),
          '%', chr(92) || '%'
        ),
        '_', chr(92) || '_'
      ) || '%' as pattern,
      greatest(1, least(coalesce(p_limit, 20), 50)) as page_limit,
      greatest(0, least(coalesce(p_offset, 0), 5000)) as page_offset
  ),
  ranked as (
    select
      wr.id as work_record_id,
      wr.workspace_id,
      w.name as workspace_name,
      wr.title,
      left(
        coalesce(
          nullif(wr.content, ''),
          nullif(wr.original_text, ''),
          nullif(n.normalized_text, ''),
          wr.title
        ),
        280
      ) as snippet,
      wr.institution,
      wr.record_type,
      wr.status,
      wr.recorded_at,
      wr.due_at,
      case
        when
          lower(btrim(coalesce(wr.title, ''))) = p.q_lower
          or lower(btrim(coalesce(wr.content, ''))) = p.q_lower
          or lower(btrim(coalesce(wr.original_text, ''))) = p.q_lower
          or lower(btrim(coalesce(wr.institution, ''))) = p.q_lower
          or lower(btrim(coalesce(n.normalized_title, ''))) = p.q_lower
          or lower(btrim(coalesce(n.normalized_text, ''))) = p.q_lower
          then 0
        when
          (
            coalesce(wr.title, '') || ' ' ||
            coalesce(wr.content, '') || ' ' ||
            coalesce(wr.original_text, '') || ' ' ||
            coalesce(wr.institution, '') || ' ' ||
            coalesce(wr.follow_up, '')
          ) ilike p.pattern
          or (
            coalesce(n.normalized_title, '') || ' ' ||
            coalesce(n.normalized_text, '') || ' ' ||
            coalesce(n.structured_data ->> 'institution', '') || ' ' ||
            coalesce(n.structured_data ->> 'project', '') || ' ' ||
            coalesce(n.structured_data ->> 'project_name', '') || ' ' ||
            coalesce(n.structured_data ->> 'person', '') || ' ' ||
            coalesce(n.structured_data ->> 'people', '') || ' ' ||
            coalesce(n.structured_data ->> 'contact', '') || ' ' ||
            coalesce(n.structured_data ->> 'keywords', '')
          ) ilike p.pattern
          then 1
        when
          n.search_aliases @> array[p.q]::text[]
          or exists (
            select 1
            from unnest(n.search_aliases) as alias_value(value)
            where lower(btrim(alias_value.value)) = p.q_lower
          )
          then 2
        else 9
      end as match_rank
    from public.work_records wr
    join public.workspaces w on w.id = wr.workspace_id
    left join public.work_record_normalizations n
      on n.work_record_id = wr.id
      and n.workspace_id = wr.workspace_id
    cross join params p
    where p.q is not null
      and (
        lower(btrim(coalesce(wr.title, ''))) = p.q_lower
        or lower(btrim(coalesce(wr.content, ''))) = p.q_lower
        or lower(btrim(coalesce(wr.original_text, ''))) = p.q_lower
        or lower(btrim(coalesce(wr.institution, ''))) = p.q_lower
        or lower(btrim(coalesce(n.normalized_title, ''))) = p.q_lower
        or lower(btrim(coalesce(n.normalized_text, ''))) = p.q_lower
        or (
          coalesce(wr.title, '') || ' ' ||
          coalesce(wr.content, '') || ' ' ||
          coalesce(wr.original_text, '') || ' ' ||
          coalesce(wr.institution, '') || ' ' ||
          coalesce(wr.follow_up, '')
        ) ilike p.pattern
        or (
          coalesce(n.normalized_title, '') || ' ' ||
          coalesce(n.normalized_text, '') || ' ' ||
          coalesce(n.structured_data ->> 'institution', '') || ' ' ||
          coalesce(n.structured_data ->> 'project', '') || ' ' ||
          coalesce(n.structured_data ->> 'project_name', '') || ' ' ||
          coalesce(n.structured_data ->> 'person', '') || ' ' ||
          coalesce(n.structured_data ->> 'people', '') || ' ' ||
          coalesce(n.structured_data ->> 'contact', '') || ' ' ||
          coalesce(n.structured_data ->> 'keywords', '')
        ) ilike p.pattern
        or n.search_aliases @> array[p.q]::text[]
        or exists (
          select 1
          from unnest(n.search_aliases) as alias_value(value)
          where lower(btrim(alias_value.value)) = p.q_lower
        )
      )
  )
  select
    r.work_record_id,
    r.workspace_id,
    r.workspace_name,
    r.title,
    r.snippet,
    r.institution,
    r.record_type,
    r.status,
    r.recorded_at,
    r.due_at,
    case r.match_rank
      when 0 then 'exact'
      when 1 then 'partial'
      when 2 then 'alias'
      else 'unknown'
    end as match_type,
    r.match_rank
  from ranked r
  cross join params p
  where r.match_rank < 9
  order by r.match_rank asc, r.recorded_at desc, r.work_record_id
  limit (select page_limit from params)
  offset (select page_offset from params);
$$;

revoke all on function public.search_my_work_records(text, integer, integer) from public, anon;
grant execute on function public.search_my_work_records(text, integer, integer) to authenticated, service_role;
