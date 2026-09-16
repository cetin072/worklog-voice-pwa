import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const app = read("public/app.js");
const html = read("public/index.html");
const css = read("public/distribution.css");
const setupHtml = read("public/setup.html");
const setupJs = read("public/setup.js");
const kakao = read("public/kakao.js");

test("platform primary path does not block on legacy Notion storage", () => {
  assert.match(app, /WorklogPlatformAuth\?\.readSession/);
  assert.match(app, /worklog:platform-auth-changed/);
  assert.doesNotMatch(app, /const NOTION_SETUP_KEY/);
});

test("home keeps the primary capture controls visible in the signed-in shell", () => {
  assert.match(html, /id="mic"/);
  assert.match(html, /id="save"/);
  assert.match(html, /id="manualEntry"/);
  assert.match(html, /id="clear"/);
  assert.match(html, /id="briefingCard"/);
  assert.match(html, /id="text"/);
});

test("welcome and Platform auth remain separate from the primary capture card", () => {
  assert.match(html, /id="welcomeCard"/);
  assert.match(html, /id="platformAuthCard"/);
  assert.doesNotMatch(html, /<section class="card voice-card core-app-card"[^>]*id="welcomeCard"/);
});

test("distribution CSS hides onboarding-only surfaces after Platform sign-in", () => {
  assert.match(css, /platform-signed-in[\s\S]*#welcomeCard/);
  assert.match(css, /platform-signed-in[\s\S]*#platformAuthCard/);
});

test("setup keeps legacy Notion management off the main capture path", () => {
  assert.match(setupHtml, /Notion 연동/);
  assert.match(setupJs, /worklogNotionConfigV1/);
  assert.match(setupJs, /\/api\/kakao/);
  assert.match(setupJs, /new URL\("\/api\/kakao", window\.location\.origin\)/);
  assert.doesNotMatch(html, /id="setup"/);
});

test("legacy Kakao push remains in setup-only assets", () => {
  assert.match(kakao, /\/api\/kakao/);
  assert.match(kakao, /kakaoBriefingAction/);
  assert.doesNotMatch(app, /kakaoBriefingAction/);
});

test("settings owns logout after Platform sign-in", () => {
  const html = read("public/settings.html");
  const source = read("public/settings.js");
  assert.match(html, /id="settingsLogoutSection"/);
  assert.match(source, /WorklogPlatformAuth\?\.signOut/);
  assert.match(source, /window\.confirm\("이 기기에서 업무수첩 계정을 로그아웃할까요\?"\)/);
  assert.doesNotMatch(source, /내 업무공간으로 돌아가기/);
});

test("legacy briefing loads only for legacy users without a Platform session", () => {
  const html = read("public/index.html");
  const loader = read("public/briefing-legacy-loader.js");
  assert.match(html, /briefing-legacy-loader\.js/);
  assert.doesNotMatch(html, /<script src="\/briefing\.js"/);
  assert.match(loader, /WorklogPlatformAuth\?\.readSession/);
  assert.match(loader, /legacyMode\(\) === "unset"/);
  assert.match(loader, /briefing\.js/);
});

test("service worker caches current standalone settings assets", () => {
  const source = read("public/sw.js");
  assert.match(source, /worklog-v39-search-detail-safe/);
  for (const asset of ["/settings.html", "/distribution.css", "/settings.css", "/notifications.js", "/settings.js", "/briefing.css", "/briefing-v2-expand-state.js", "/platform-auth.js", "/platform-auth-ui.js", "/onboarding.js", "/briefing-legacy-loader.js"]) {
    assert.ok(source.includes(`\"${asset}\"`), `missing ${asset}`);
  }
  assert.ok(!source.includes('"/kakao.js"'), "legacy Kakao UI asset should not be precached");
});
