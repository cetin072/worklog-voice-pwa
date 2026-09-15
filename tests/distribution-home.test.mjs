import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("distribution home exposes social preview metadata", () => {
  const html = read("public/index.html");
  assert.match(html, /property="og:title"/);
  assert.match(html, /property="og:description"/);
  assert.match(html, /property="og:url" content="https:\/\/worklog-voice-pwa\.netlify\.app\/"/);
  assert.match(html, /property="og:image" content="https:\/\/worklog-voice-pwa\.netlify\.app\/icons\/icon-512-v3\.png"/);
  assert.doesNotMatch(html, /Notion 업무 통합 기록에 저장/);
  assert.match(html, /말하면 기록되고, 일정까지 한눈에/);
});

test("distribution home restores settings with optional Notion", () => {
  const html = read("public/index.html");
  assert.match(html, /id="settingsOpen"/);
  assert.match(html, /id="settingsCard"/);
  assert.match(html, /href="\/setup\.html"/);
  assert.match(html, /Notion 연결 <span class="settings-optional">선택<\/span>/);
  assert.match(html, /id="settingsShare"/);
});

test("new-user onboarding prefers Platform auth instead of forcing Notion", () => {
  const source = read("public/onboarding.js");
  assert.match(source, /WorklogPlatformAuth\?\.readSession/);
  assert.match(source, /platformAuthCard/);
  assert.match(source, /무료로 시작하거나 로그인/);
  assert.doesNotMatch(source, /location\.href\s*=\s*["']\/setup\.html/);
  assert.doesNotMatch(source, /Notion 연결이 먼저 필요합니다/);
});

test("auth UI controls distribution signed-in and signed-out states", () => {
  const source = read("public/platform-auth-ui.js");
  assert.match(source, /platform-signed-out/);
  assert.match(source, /platform-signed-in/);
  assert.match(source, /worklog:platform-auth-changed/);
  assert.match(source, /Notion 연결 없이 바로 사용할 수 있습니다/);
});

test("service worker caches new distribution and settings assets", () => {
  const source = read("public/sw.js");
  assert.match(source, /worklog-v28/);
  for (const asset of ["/distribution.css", "/settings.css", "/settings.js", "/platform-auth.js", "/platform-auth-ui.js", "/onboarding.js"]) {
    assert.ok(source.includes(`\"${asset}\"`), `missing ${asset}`);
  }
});
