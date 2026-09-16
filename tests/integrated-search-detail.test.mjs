import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const search = read("public/search.js");
const detail = read("public/search-detail.js");
const state = read("public/main-ui-state.js");
const sw = read("public/sw.js");

test("search result cards expose a validated WorkRecord id and native keyboard semantics", () => {
  assert.match(search, /const UUID_RE =/);
  assert.match(search, /const recordId = workRecordId\(row\?\.work_record_id\)/);
  assert.match(search, /li\.dataset\.workRecordId = recordId/);
  assert.match(search, /li\.tabIndex = 0/);
  assert.match(search, /li\.setAttribute\("role", "button"\)/);
  assert.match(search, /상세 보기/);
  assert.match(search, /results\.addEventListener\("click"/);
  assert.match(search, /results\.addEventListener\("keydown"/);
  assert.match(search, /event\.key !== "Enter" && event\.key !== " "/);
});

test("detail module is cache-busted, prewarmed on search open, and retried after load failure", () => {
  assert.match(search, /DETAIL_SCRIPT_PATH = "\/search-detail\.js\?v=20260916-2"/);
  assert.match(search, /function ensureDetailModule\(\)/);
  assert.match(search, /detailModulePromise = null/);
  assert.match(search, /ensureDetailModule\(\)\.catch\(\(\) => \{\}\)/);
  assert.match(state, /\/search\.js\?v=20260916-4/);
  for (const asset of ["/search.css", "/search.js", "/search-detail.js"]) {
    assert.ok(sw.includes(`\"${asset}\"`), `missing search PWA asset: ${asset}`);
  }
});

test("record detail fetches exactly one RLS-scoped WorkRecord with the signed-in user JWT", () => {
  assert.match(detail, /\/rest\/v1\/work_records/);
  assert.match(detail, /url\.searchParams\.set\("id", `eq\.\$\{recordId\}`\)/);
  assert.match(detail, /url\.searchParams\.set\("limit", "1"\)/);
  assert.match(detail, /authorization: `Bearer \$\{accessToken\}`/);
  assert.match(detail, /apikey: config\.publishableKey/);
  assert.match(detail, /auth\?\.refreshSession/);
  assert.match(detail, /cache: "no-store"/);
  assert.doesNotMatch(detail, /service[_-]?role|sb_secret|SUPABASE_SERVICE/i);
});

test("detail supports mobile history/back/escape without closing the parent search first", () => {
  assert.match(detail, /SEARCH_HISTORY_KEY = "worklogSearchOpen"/);
  assert.match(detail, /DETAIL_HISTORY_KEY = "worklogSearchDetail"/);
  assert.match(detail, /window\.history\.pushState/);
  assert.match(detail, /window\.addEventListener\("popstate"/);
  assert.match(detail, /event\.stopImmediatePropagation\(\)/);
  assert.match(detail, /clearDetailHistoryFlag\(\)/);
  assert.match(detail, /worklog:platform-auth-changed/);
});

test("detail uses current provenance shape and hides legacy/unverified institution metadata", () => {
  assert.match(detail, /metadata\?\.fieldProvenance\?\.institution/);
  assert.match(detail, /\["user_selected", "user_confirmed"\]\.includes\(provenance\)/);
  assert.match(detail, /appendMeta\(meta, trustedInstitution\(row\)\)/);
  assert.doesNotMatch(detail, /legacy_unverified.*includes|auto_derived.*includes|unverified.*includes/);
});

test("record detail renders user data with textContent only", () => {
  assert.match(detail, /paragraph\.textContent = normalized/);
  assert.match(detail, /title\.textContent = text\(row\?\.title\)/);
  assert.match(detail, /appendSection\(card, "기록 내용", content \|\| original\)/);
  assert.match(detail, /if \(original && original !== content\) appendSection\(card, "원문", original\)/);
  assert.doesNotMatch(detail, /paragraph\.innerHTML|title\.innerHTML|card\.innerHTML\s*=\s*.*row/);
});
