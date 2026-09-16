-- Issue #255 follow-up: enforce the client query-length boundary on the RPC itself.
-- Authenticated callers can invoke RPCs directly, so the server must reject oversized
-- search strings before constructing ILIKE patterns or scanning search fields.

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
  candidates as (
    select
      wr.id as work_record_id,
      wr.workspace_id,
      w.name as workspace_name,
      wr.title,
      wr.content,
      wr.original_text,
      n.normalized_text,
      wr.institution,
      wr.record_type,
      wr.status,
      wr.recorded_at,
      wr.due_at,
      p.q_lower,
      p.pattern,
      case
        when
          lower(btrim(coalesce(wr.title, ''))) = p.q_lower
          or lower(btrim(coalesce(wr.content, ''))) = p.q_lower
          or lower(btrim(coalesce(wr.institution, ''))) = p.q_lower
          or lower(btrim(coalesce(n.normalized_title, ''))) = p.q_lower
          or lower(btrim(coalesce(n.normalized_text, ''))) = p.q_lower
          then 0
        when
          (
            coalesce(wr.title, '') || ' ' ||
            coalesce(wr.content, '') || ' ' ||
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
        when coalesce(wr.original_text, '') ilike p.pattern then 3
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
    r.institution,
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
