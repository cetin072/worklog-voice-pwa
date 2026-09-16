-- Issue #251: bounded/idempotent baseline backfill for existing WorkRecords.
-- This operation only inserts derived rows. It never updates work_records or original_text.

create or replace function private.backfill_work_record_normalization_baseline(p_limit integer default 25)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
  v_inserted integer := 0;
begin
  with candidates as (
    select wr.*
    from public.work_records wr
    left join public.work_record_normalizations n
      on n.work_record_id = wr.id
    where n.work_record_id is null
    order by wr.created_at asc, wr.id asc
    limit v_limit
  ), inserted as (
    insert into public.work_record_normalizations (
      work_record_id,
      workspace_id,
      created_by_user_id,
      processing_status,
      normalized_title,
      normalized_text,
      structured_data,
      search_aliases,
      confidence,
      review_state,
      normalization_version,
      source_quality,
      normalized_at
    )
    select
      c.id,
      c.workspace_id,
      c.created_by_user_id,
      case
        when nullif(btrim(c.original_text), '') is null then 'needs_review'
        else 'completed'
      end,
      left(c.title, 200),
      left(coalesce(
        nullif(btrim(c.content), ''),
        nullif(btrim(c.original_text), ''),
        c.title
      ), 10000),
      jsonb_strip_nulls(jsonb_build_object(
        'institution', nullif(btrim(coalesce(c.institution, '')), ''),
        'dueAt', c.due_at,
        'status', c.status,
        'recordType', c.record_type,
        'followUp', c.follow_up,
        'entities', '[]'::jsonb,
        'sourceQuality', case
          when nullif(btrim(c.original_text), '') is null then 'fallback_content'
          else 'original'
        end
      )),
      case
        when nullif(btrim(coalesce(c.institution, '')), '') is null then '{}'::text[]
        else array[btrim(c.institution)]::text[]
      end,
      case
        when nullif(btrim(c.original_text), '') is null then 0.5500
        else 0.9000
      end,
      case
        when nullif(btrim(c.original_text), '') is null then 'needs_review'
        else 'unreviewed'
      end,
      'baseline-backfill-v0',
      case
        when nullif(btrim(c.original_text), '') is null then 'fallback_content'
        else 'original'
      end,
      now()
    from candidates c
    on conflict (work_record_id) do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end;
$$;

revoke all on function private.backfill_work_record_normalization_baseline(integer)
  from public, anon, authenticated;
grant execute on function private.backfill_work_record_normalization_baseline(integer)
  to service_role;
