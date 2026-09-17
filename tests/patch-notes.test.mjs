import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const settings = read("public/settings.html");
const settingsCss = read("public/settings.css");
const patchNotes = read("public/patch-notes.html");
const patchCss = read("public/patch-notes.css");
const sw = read("public/sw.js");

test("settings exposes patch notes beside the top-right completion action", () => {
  assert.match(settings, /class="settings-header-actions"[\s\S]*id="settingsPatchNotes"[\s\S]*class="settings-close"/);
  assert.match(settings, /id="settingsPatchNotes"[^>]+href="\/patch-notes\.html"[^>]+aria-label="패치 노트"[^>]+title="패치 노트"/);
  assert.match(settings, /id="settingsPatchNotes"[^>]*>📝<\/a>/);
  assert.doesNotMatch(settings, /<h2>업무수첩 정보<\/h2>/);
  assert.doesNotMatch(settings, />패치 노트 확인하기<\/a>/);
  assert.match(settings, /settings\.css\?v=20260916-3/);
  assert.match(settingsCss, /\.settings-header-actions\{display:flex;align-items:center;gap:8px\}/);
  assert.match(settingsCss, /\.settings-patch-notes-shortcut\{[^}]*width:42px;height:42px/);
});

test("patch notes only present shipped-history framing and current briefing/edit changes", () => {
  assert.match(patchNotes, /GitHub <code>main<\/code>에 병합된 기능/);
  assert.match(patchNotes, /지난 것 \/ 오늘 할 일 \/ 다가오는 업무 \/ 기한 없는 업무/);
  assert.match(patchNotes, /업무 편집 확장/);
  assert.match(patchNotes, /업무명뿐 아니라 날짜와 시간을 함께 수정/);
  assert.match(patchNotes, /날짜를 비우면 기한 없는 업무/);
  assert.match(patchNotes, /2026\. 8\. 24\./);
  assert.doesNotMatch(patchNotes, /Draft\/실험 기능을 완료 기능/);
});

test("patch notes use the current v4 app icon and have dedicated mobile styles", () => {
  assert.match(patchNotes, /icon-192-v4\.png/);
  assert.match(patchNotes, /patch-notes\.css\?v=20260916-2/);
  assert.match(patchCss, /@media\(max-width:480px\)/);
});

test("service worker precaches patch notes with the current brand cache strategy", () => {
  assert.match(sw, /const CACHE="worklog-v41-home-briefing-dedup"/);
  assert.match(sw, /"\/patch-notes\.html"/);
  assert.match(sw, /"\/patch-notes\.css"/);
  assert.match(sw, /url\.pathname\.startsWith\("\/api\/"\)/);
});
