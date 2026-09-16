import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const source = read("public/search.js");
const css = read("public/search.css");

test("home search entry is a compact header action instead of an always-visible card", () => {
  assert.match(source, /id = "worklogSearchOpen"/);
  assert.match(source, /document\.querySelector\("\.header-actions"\)/);
  assert.match(source, /actions\.insertBefore\(button, settings \|\| null\)/);
  assert.doesNotMatch(source, /search-card core-app-card/);
  assert.doesNotMatch(source, /insertAdjacentElement\("afterend", card\)/);
  assert.match(css, /\.search-open\{/);
  assert.match(css, /\.search-open-label\{display:none\}/);
  assert.match(css, /@media\(min-width:560px\).*\.search-open-label\{display:inline\}/s);
});

test("search opens as an accessible full-screen mobile dialog", () => {
  assert.match(source, /id = "searchScreen"/);
  assert.match(source, /setAttribute\("role", "dialog"\)/);
  assert.match(source, /setAttribute\("aria-modal", "true"\)/);
  assert.match(source, /지난 업무 검색/);
  assert.match(source, /검색 닫기/);
  assert.match(css, /\.search-screen\{position:fixed;inset:0;z-index:1000/);
  assert.match(css, /\.search-screen-open\{overflow:hidden\}/);
  assert.match(source, /document\.body\.classList\.add\("search-screen-open"\)/);
  assert.match(source, /requestAnimationFrame\(\(\) => els\.input\.focus\(\)\)/);
});

test("mobile back, escape and sign-out close search safely", () => {
  assert.match(source, /window\.history\.pushState/);
  assert.match(source, /window\.addEventListener\("popstate"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /clearHistoryFlag\(\)/);
  assert.match(source, /els\.open\.hidden = !available/);
});

test("aborted older searches cannot clear a newer search loading state", () => {
  assert.match(source, /if \(activeController !== controller\) return;\s*activeController = null;\s*setLoading\(els, false\);/s);
  assert.match(source, /function cancelActiveSearch\(els\)/);
  assert.match(source, /els\.input\.addEventListener\("search"[\s\S]*cancelActiveSearch\(els\)/);
});
