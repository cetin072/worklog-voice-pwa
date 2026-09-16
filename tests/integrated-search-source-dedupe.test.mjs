import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../supabase/migrations/20260916172500_integrated_search_source_dedupe.sql", import.meta.url), "utf8");

test("shared original_text is only a fallback after direct and alias matches", () => {
  assert.match(sql, /when coalesce\(wr\.original_text, ''\) ilike p\.pattern then 3/i);
  assert.match(sql, /when 0 then 'exact'/i);
  assert.match(sql, /when 1 then 'partial'/i);
  assert.match(sql, /when 2 then 'alias'/i);
  assert.match(sql, /when 3 then 'partial'/i);
});

test("source-only split siblings are deduped while stronger siblings remain", () => {
  assert.match(sql, /row_number\(\) over/i);
  assert.match(sql, /partition by\s+c\.workspace_id/i);
  assert.match(sql, /order by c\.match_rank asc, c\.recorded_at desc, c\.work_record_id/i);
  assert.match(sql, /r\.match_rank < 3\s+or \(r\.match_rank = 3 and r\.source_group_row = 1\)/i);
});

test("source fallback snippet is centered near the actual query", () => {
  assert.match(sql, /strpos\(lower\(r\.original_text\), r\.q_lower\) - 80/i);
  assert.match(sql, /for 280/i);
});

test("search source dedupe remains security invoker and authenticated-only", () => {
  assert.match(sql, /security invoker/i);
  assert.doesNotMatch(sql, /security definer/i);
  assert.match(sql, /revoke all on function public\.search_my_work_records\(text, integer, integer\) from public, anon/i);
  assert.match(sql, /grant execute on function public\.search_my_work_records\(text, integer, integer\) to authenticated, service_role/i);
});
