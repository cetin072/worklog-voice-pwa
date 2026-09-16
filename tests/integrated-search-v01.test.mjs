import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("integrated search migration preserves RLS with a bounded security-invoker RPC", () => {
  const sql = read("supabase/migrations/20260916165000_integrated_search_v01.sql");

  assert.match(sql, /create extension if not exists pg_trgm with schema extensions/i);
  assert.match(sql, /work_records_search_text_trgm_idx/);
  assert.match(sql, /work_record_normalizations_search_text_trgm_idx/);
  assert.match(sql, /extensions\.gin_trgm_ops/);
  assert.match(sql, /create or replace function public\.search_my_work_records/i);
  assert.match(sql, /security invoker/i);
  assert.doesNotMatch(sql, /security definer/i);
  assert.match(sql, /least\(coalesce\(p_limit, 20\), 50\)/i);
  assert.match(sql, /least\(coalesce\(p_offset, 0\), 5000\)/i);
  assert.match(sql, /revoke all on function public\.search_my_work_records\(text, integer, integer\) from public, anon/i);
  assert.match(sql, /grant execute on function public\.search_my_work_records\(text, integer, integer\) to authenticated, service_role/i);
});

test("integrated search covers raw, normalized, structured and alias fields in the required ranking order", () => {
  const sql = read("supabase/migrations/20260916165000_integrated_search_v01.sql");

  for (const field of [
    "wr.title",
    "wr.content",
    "wr.original_text",
    "wr.institution",
    "n.normalized_title",
    "n.normalized_text",
    "n.search_aliases",
    "structured_data ->> 'institution'",
    "structured_data ->> 'project'",
    "structured_data ->> 'person'",
    "structured_data ->> 'keywords'",
  ]) assert.ok(sql.includes(field), `missing search field: ${field}`);

  assert.match(sql, /search_aliases @> array\[p\.q\]::text\[\]/);
  const exact = sql.indexOf("when 0 then 'exact'");
  const partial = sql.indexOf("when 1 then 'partial'");
  const alias = sql.indexOf("when 2 then 'alias'");
  assert.ok(exact >= 0 && exact < partial && partial < alias, "ranking must stay exact -> partial -> alias");
  assert.match(sql, /order by r\.match_rank asc, r\.recorded_at desc/i);

  const executableSql = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .toLowerCase();
  for (const forbidden of ["vector", "embedding", "openai", "gemini", "claude"]) {
    assert.doesNotMatch(executableSql, new RegExp(forbidden));
  }
});

test("search client queries only the bounded RPC with the signed-in Supabase session", () => {
  const source = read("public/search.js");

  assert.match(source, /const PAGE_SIZE = 20/);
  assert.match(source, /\/rest\/v1\/rpc\/search_my_work_records/);
  assert.match(source, /p_limit:\s*PAGE_SIZE \+ 1/);
  assert.match(source, /p_offset:\s*offset/);
  assert.match(source, /WorklogPlatformAuth/);
  assert.match(source, /authorization:\s*`Bearer \$\{accessToken\}`/);
  assert.match(source, /refreshSession/);
  assert.match(source, /AbortController/);
  assert.doesNotMatch(source, /\/rest\/v1\/work_records/);
  assert.doesNotMatch(source.toLowerCase(), /embedding|openai|gemini|claude/);
});

test("search client has mobile-facing loading empty error and pagination states without dynamic result HTML", () => {
  const source = read("public/search.js");
  const css = read("public/search.css");

  assert.match(source, /검색 중…/);
  assert.match(source, /검색 결과가 없습니다/);
  assert.match(source, /검색 중 오류가 발생했습니다/);
  assert.match(source, /더 보기/);
  assert.match(source, /\.textContent =/);
  assert.match(source, /results\.replaceChildren/);
  assert.match(css, /@media\(max-width:480px\)/);
  assert.match(css, /\.search-results/);
  assert.match(css, /\.search-status\.error/);
});

test("home state loader adds search lazily without changing the core capture app shell", () => {
  const html = read("public/index.html");
  const state = read("public/main-ui-state.js");

  assert.match(html, /id="mic"/);
  assert.match(html, /id="text"/);
  assert.match(state, /\/search\.js\?v=20260916-1/);
  assert.match(state, /data-worklog-search/);
  assert.match(state, /document\.head\.append\(script\)/);
});
