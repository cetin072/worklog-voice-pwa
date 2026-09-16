import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const settings = read("public/settings.html");
const patchNotes = read("public/patch-notes.html");
const patchCss = read("public/patch-notes.css");
const sw = read("public/sw.js");

test("settings exposes the user-facing patch notes entry", () => {
  assert.match(settings, /id="settingsPatchNotes"/);
  assert.match(settings, /href="\/patch-notes\.html"/);
  assert.match(settings, /패치 노트 확인하기/);
});

test("patch notes only present shipped-history framing and current briefing/edit changes", () => {
  assert.match(patchNotes, /GitHub <code>main<\/code>에 병합된 기능/);
  assert.match(patchNotes, /지난 것 \/ 오늘 할 일 \/ 다가오는 업무 \/ 기한 없는 업무/);
  assert.match(patchNotes, /Data Core 업무 편집/);
  assert.match(patchNotes, /예전 Notion 운영자 접근키를 요구하지 않고/);
  assert.match(patchNotes, /2026\. 8\. 24\./);
  assert.doesNotMatch(patchNotes, /Draft\/실험 기능을 완료 기능/);
});

test("patch notes use the current v4 app icon and have dedicated mobile styles", () => {
  assert.match(patchNotes, /icon-192-v4\.png/);
  assert.match(patchNotes, /patch-notes\.css\?v=20260916-2/);
  assert.match(patchCss, /@media\(max-width:480px\)/);
});

test("service worker precaches patch notes without changing existing cache strategy name", () => {
  assert.match(sw, /const CACHE="worklog-v38-unified-launch-splash"/);
  assert.match(sw, /"\/patch-notes\.html"/);
  assert.match(sw, /"\/patch-notes\.css"/);
  assert.match(sw, /url\.pathname\.startsWith\("\/api\/"\)/);
});
