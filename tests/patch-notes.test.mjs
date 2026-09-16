import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("settings exposes a standalone patch notes entry", () => {
  const settings = read("public/settings.html");
  assert.match(settings, /<h2>업무수첩 정보<\/h2>/);
  assert.match(settings, /id="settingsPatchNotes"[^>]+href="\/patch-notes\.html"/);
  assert.match(settings, />패치 노트 확인하기<\/a>/);
});

test("patch notes are newest-first and cover merged product history from 2026-08-24", () => {
  const html = read("public/patch-notes.html");
  const dates = [
    "2026-09-16",
    "2026-09-15",
    "2026-09-14",
    "2026-09-13",
    "2026-09-12",
    "2026-09-11",
    "2026-09-10",
    "2026-09-09",
    "2026-09-07",
    "2026-09-05",
    "2026-09-04",
    "2026-08-28",
    "2026-08-27",
    "2026-08-25",
    "2026-08-24",
  ];

  let previous = -1;
  for (const date of dates) {
    const index = html.indexOf(`data-date="${date}"`);
    assert.ok(index > previous, `missing or out-of-order patch note date: ${date}`);
    previous = index;
  }
});

test("patch notes surface major user-visible milestones", () => {
  const html = read("public/patch-notes.html");
  for (const marker of [
    "홈 UX 0.2",
    "통합 검색 0.1",
    "오전 8:30",
    "오후 4:30",
    "기록 정제 0.1",
    "Google 로그인",
    "Data Core",
    "브리핑 2.0",
    "카카오톡",
    "직접 입력",
    "연속 음성 기록",
  ]) {
    assert.ok(html.includes(marker), `missing patch-note milestone: ${marker}`);
  }
});

test("patch notes do not present unmerged scanner drafts as shipped features", () => {
  const html = read("public/patch-notes.html");
  assert.doesNotMatch(html, /문서 스캔 입력 \+ Notion 첨부 V1/);
  assert.doesNotMatch(html, /다중 스캔 PDF 저장\/공유/);
  assert.match(html, /병합되지 않은 실험 기능은 완료 기능으로 표시하지 않습니다/);
});

test("repository changelog contains the same historical date baseline", () => {
  const changelog = read("CHANGELOG.md");
  assert.match(changelog, /## 2026-09-16/);
  assert.match(changelog, /## 2026-08-24/);
  assert.match(changelog, /실제 `main`에 반영된 제품 변경/);
});

test("patch notes are available in the PWA cache", () => {
  const sw = read("public/sw.js");
  assert.ok(sw.includes('"/patch-notes.html"'));
  assert.ok(sw.includes('"/patch-notes.css"'));
});
