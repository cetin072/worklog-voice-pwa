import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../supabase/migrations/20260916174500_integrated_search_query_guard.sql", import.meta.url), "utf8");

test("search RPC rejects oversized queries before building patterns", () => {
  assert.match(sql, /char_length\(raw_q\) <= 120/i);
  assert.match(sql, /case when raw_q is not null and char_length\(raw_q\) <= 120 then raw_q end as q/i);
  assert.match(sql, /where p\.q is not null/i);
});

test("query guard keeps bounded pagination and RLS-safe execution", () => {
  assert.match(sql, /least\(coalesce\(p_limit, 20\), 50\)/i);
  assert.match(sql, /least\(coalesce\(p_offset, 0\), 5000\)/i);
  assert.match(sql, /security invoker/i);
  assert.doesNotMatch(sql, /security definer/i);
  assert.match(sql, /revoke all on function public\.search_my_work_records\(text, integer, integer\) from public, anon/i);
  assert.match(sql, /grant execute on function public\.search_my_work_records\(text, integer, integer\) to authenticated, service_role/i);
});

test("query guard preserves source-only dedupe", () => {
  assert.match(sql, /when coalesce\(wr\.original_text, ''\) ilike p\.pattern then 3/i);
  assert.match(sql, /row_number\(\) over/i);
  assert.match(sql, /r\.match_rank < 3\s+or \(r\.match_rank = 3 and r\.source_group_row = 1\)/i);
});
