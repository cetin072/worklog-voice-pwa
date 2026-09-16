import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration=fs.readFileSync(new URL("../supabase/migrations/20260916162000_work_record_normalization_baseline_backfill.sql",import.meta.url),"utf8");

test("baseline backfill is private, bounded and idempotent",()=>{
  assert.match(migration,/create or replace function private\.backfill_work_record_normalization_baseline\(p_limit integer default 25\)/i);
  assert.match(migration,/greatest\(1, least\(coalesce\(p_limit, 25\), 100\)\)/i);
  assert.match(migration,/limit v_limit/i);
  assert.match(migration,/on conflict \(work_record_id\) do nothing/i);
  assert.match(migration,/revoke all on function private\.backfill_work_record_normalization_baseline\(integer\)[\s\S]*from public, anon, authenticated/i);
  assert.match(migration,/grant execute on function private\.backfill_work_record_normalization_baseline\(integer\)[\s\S]*to service_role/i);
});

test("baseline backfill only writes derived normalization rows",()=>{
  assert.match(migration,/insert into public\.work_record_normalizations/i);
  assert.doesNotMatch(migration,/update\s+public\.work_records/i);
  assert.doesNotMatch(migration,/delete\s+from\s+public\.work_records/i);
  assert.doesNotMatch(migration,/insert\s+into\s+public\.work_records/i);
  assert.match(migration,/'baseline-backfill-v0'/);
});

test("records without original text remain review-required",()=>{
  assert.match(migration,/when nullif\(btrim\(c\.original_text\), ''\) is null then 'needs_review'/i);
  assert.match(migration,/when nullif\(btrim\(c\.original_text\), ''\) is null then 0\.5500/i);
  assert.match(migration,/when nullif\(btrim\(c\.original_text\), ''\) is null then 'fallback_content'/i);
});

test("baseline structured data and institution alias are search-ready",()=>{
  assert.match(migration,/'institution'/);
  assert.match(migration,/'dueAt'/);
  assert.match(migration,/'status'/);
  assert.match(migration,/'recordType'/);
  assert.match(migration,/array\[btrim\(c\.institution\)\]::text\[\]/i);
});
