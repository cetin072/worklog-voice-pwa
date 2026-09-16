import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const search = read("public/search.js");
const detail = read("public/search-detail.js");

test("search result cards expose a stable WorkRecord id and keyboard button semantics", () => {
  assert.match(search, /const recordId = text\(row\?\.work_record_id\)/);
  assert.match(search, /li\.dataset\.workRecordId = recordId/);
  assert.match(search, /li\.tabIndex = 0/);
  assert.match(search, /li\.setAttribute\("role", "button"\)/);
  assert.match(search, /상세 보기/);
  assert.match(search, /DETAIL_SCRIPT_PATH = "\/search-detail\.js\?v=20260916-1"/);
  assert.match(search, /ensureDetailModule\(\)/);
});

test("record detail fetches exactly one RLS-scoped WorkRecord with the signed-in user JWT", () => {
  assert.match(detail, /\/rest\/v1\/work_records/);
  assert.match(detail, /url\.searchParams\.set\("id", `eq\.\$\{recordId\}`\)/);
  assert.match(detail, /url\.searchParams\.set\("limit", "1"\)/);
  assert.match(detail, /authorization: `Bearer \$\{accessToken\}`/);
  assert.match(detail, /apikey: config\.publishableKey/);
  assert.match(detail, /auth\?\.refreshSession/);
  assert.doesNotMatch(detail, /service[_-]?role|sb_secret|SUPABASE_SERVICE/i);
});

test("record detail uses mobile back history and supports tap, keyboard and escape", () => {
  assert.match(detail, /DETAIL_HISTORY_KEY = "worklogSearchDetail"/);
  assert.match(detail, /window\.history\.pushState/);
  assert.match(detail, /window\.addEventListener\("popstate"/);
  assert.match(detail, /results\.addEventListener\("click"/);
  assert.match(detail, /results\.addEventListener\("keydown"/);
  assert.match(detail, /event\.key !== "Enter" && event\.key !== " "/);
  assert.match(detail, /event\.stopImmediatePropagation\(\)/);
});

test("detail hides unverified legacy institution metadata and renders record text safely", () => {
  assert.match(detail, /\["user_selected", "user_confirmed"\]\.includes\(provenance\)/);
  assert.match(detail, /paragraph\.textContent = normalized/);
  assert.match(detail, /title\.textContent = text\(row\?\.title\)/);
  assert.match(detail, /appendSection\(card, "기록 내용", content \|\| original\)/);
  assert.match(detail, /if \(original && original !== content\) appendSection\(card, "원문", original\)/);
  assert.doesNotMatch(detail, /innerHTML\s*=\s*.*row\?/s);
});
