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
  assert.doesNotMatch(html, /Notion 연결은 필요하지 않습니다/);
  assert.match(html, /말하면 기록되고, 일정까지 한눈에/);
});

test("distribution home routes settings to a standalone page", () => {
  const html = read("public/index.html");
  const settings = read("public/settings.html");
  assert.match(html, /id="settingsOpen"[^>]+href="\/settings\.html"/);
  assert.doesNotMatch(html, /id="settingsCard"/);
  assert.match(settings, /id="settingsPage"/);
  assert.match(settings, /href="\/setup\.html"/);
  assert.match(settings, /Notion 연결 <span class="settings-optional">선택<\/span>/);
  assert.match(settings, /id="settingsShare"/);
  assert.match(settings, /id="settingsLogout"/);
});

test("platform explanation is a compact collapsed details card before settings", () => {
  const html = read("public/settings.html");
  const about = html.indexOf('id="settingsPlatformAbout"');
  const display = html.indexOf("화면 표시");
  assert.ok(about >= 0 && about < display, "platform roadmap should appear before settings controls");
  assert.match(html, /<details id="settingsPlatformAbout"/);
  assert.doesNotMatch(html, /<details id="settingsPlatformAbout"[^>]*\sopen(?:\s|>)/);
  assert.match(html, /업무수첩이란\?/);
  assert.match(html, /자세히 알아보기/);
  assert.match(html, /현재 기본 기능/);
  assert.match(html, /현재 제공/);
  assert.match(html, /다음 단계/);
  assert.match(html, /확장 예정/);
  assert.match(html, /카카오 알림/);
  assert.match(html, /PDF/);
  assert.match(html, /통화 녹음 가져오기·요약/);
  assert.match(html, /회의 녹음·회의록/);
  assert.match(html, /개발 순서와 구성은 안정성 및 우선순위에 따라 조정될 수 있습니다/);
});

test("settings defaults briefing open and offers only whole-card collapse", () => {
  const html = read("public/settings.html");
  const source = read("public/settings.js");
  const collapseState = read("public/briefing-v2-expand-state.js");
  const briefingV2 = read("public/briefing-v2.js");
  const display = html.indexOf("화면 표시");
  const notion = html.indexOf("Notion 연결");
  const install = html.indexOf("앱 설치");
  const account = html.indexOf("내 계정");
  const share = html.indexOf("업무수첩 공유");
  const logout = html.indexOf("로그아웃");
  assert.ok(display >= 0 && display < notion);
  assert.ok(notion < install);
  assert.ok(install < account);
  assert.ok(account < share);
  assert.ok(share < logout);
  assert.match(html, /id="settingsBriefingCollapsed"/);
  assert.doesNotMatch(html, /settingsEntryDetailsExpanded/);
  assert.doesNotMatch(html, /업무 브리핑 목록 기본 펼치기/);
  assert.match(source, /briefingCollapsed:\s*false/);
  assert.match(source, /stored\?\.briefingCollapsed === true/);
  assert.match(collapseState, /briefingCardToggle/);
  assert.match(collapseState, /classList\.toggle\("is-collapsed"/);
  assert.match(collapseState, /collapsed \? "펼치기" : "접기"/);
  assert.match(briefingV2, /const MAX_VISIBLE=3/);
  assert.match(briefingV2, /개 더 보기/);
});

test("direct input exposes only text and save while keeping inference compatibility hidden", () => {
  const html = read("public/index.html");
  const start = html.indexOf('<section id="entryCard"');
  const end = html.indexOf("<footer>", start);
  const entry = html.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(entry, />직접 입력<\/label>/);
  assert.match(entry, /id="text"/);
  assert.match(entry, /id="typedSave"/);
  assert.match(entry, /id="entryCompatibilityFields" hidden/);
  assert.doesNotMatch(entry, /class="grid"/);
  assert.doesNotMatch(entry, /id="entryExtraDetails"/);
  assert.doesNotMatch(entry, />기관<\/span>/);
  assert.doesNotMatch(entry, />상태<\/span>/);
  assert.doesNotMatch(entry, />유형<\/span>/);
  assert.doesNotMatch(entry, /추가 정보/);
});

test("settings exposes a platform-aware install action", () => {
  const html = read("public/settings.html");
  const source = read("public/settings.js");
  assert.match(html, /id="settingsInstallAction"/);
  assert.match(html, /id="settingsInstallStatus"/);
  assert.match(source, /beforeinstallprompt/);
  assert.match(source, /deferredInstallPrompt/);
  assert.match(source, /\.prompt\(\)/);
  assert.match(source, /appinstalled/);
  assert.match(source, /iPhone\/iPad 설치/);
  assert.match(source, /홈 화면에 추가/);
});

test("new-user onboarding prefers Platform auth instead of forcing Notion", () => {
  const source = read("public/onboarding.js");
  assert.match(source, /WorklogPlatformAuth\?\.readSession/);
  assert.match(source, /platformAuthCard/);
  assert.match(source, /무료로 시작하거나 로그인/);
  assert.doesNotMatch(source, /location\.href\s*=\s*["']\/setup\.html/);
  assert.doesNotMatch(source, /Notion 연결이 먼저 필요합니다/);
});

test("Google is the primary sign-in action while email remains available", () => {
  const html = read("public/index.html");
  const googleIndex = html.indexOf('id="platformGoogleSignIn"');
  const emailIndex = html.indexOf('id="platformAuthForm"');
  assert.ok(googleIndex > -1, "Google sign-in button missing");
  assert.ok(emailIndex > googleIndex, "Google sign-in should appear before email form");
  assert.match(html, /Google로 시작/);
  assert.match(html, /또는 이메일로/);
  assert.match(html, /id="platformSignIn"/);
  assert.match(html, /id="platformSignUp"/);
  for (const color of ["#4285F4", "#34A853", "#FBBC05", "#EA4335"]) assert.ok(html.includes(color));
});

test("Google OAuth uses Supabase authorize and only persists Supabase session tokens", () => {
  const source = read("public/platform-auth.js");
  assert.match(source, /\/auth\/v1\/authorize/);
  assert.match(source, /searchParams\.set\("provider", "google"\)/);
  assert.match(source, /searchParams\.set\("redirect_to", redirectTo\)/);
  assert.match(source, /params\.get\("access_token"\)/);
  assert.match(source, /params\.get\("refresh_token"\)/);
  assert.match(source, /grant_type=refresh_token/);
  assert.doesNotMatch(source, /provider_token/);
  assert.doesNotMatch(source, /provider_refresh_token/);
});

test("auth UI wires Google sign-in and hides signed-in account card", () => {
  const source = read("public/platform-auth-ui.js");
  assert.match(source, /platformGoogleSignIn/);
  assert.match(source, /signInWithGoogle/);
  assert.match(source, /platform-signed-out/);
  assert.match(source, /platform-signed-in/);
  assert.match(source, /worklog:platform-auth-changed/);
  assert.match(source, /card\.hidden = true;\n    setAuthState\("platform-signed-in", user\)/);
  assert.doesNotMatch(source, /Notion 연결 없이 바로 사용할 수 있습니다/);
});

test("legacy Kakao connection UI stays hidden until multi-user delivery is ready", () => {
  const html = read("public/index.html");
  const contract = read("scripts/uar-ui-contract.mjs");
  assert.doesNotMatch(html, /id="kakaoDelivery"/);
  assert.doesNotMatch(html, /id="kakaoBriefingAction"/);
  assert.doesNotMatch(html, /<script[^>]+src="\/kakao\.js"/);
  assert.doesNotMatch(contract, /kakaoBriefingAction/);
  assert.doesNotMatch(contract, /['"]\/kakao\.js['"]/);
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
  assert.match(source, /worklog-v35/);
  for (const asset of ["/settings.html", "/distribution.css", "/settings.css", "/notifications.js", "/settings.js", "/briefing.css", "/briefing-v2-expand-state.js", "/platform-auth.js", "/platform-auth-ui.js", "/onboarding.js", "/briefing-legacy-loader.js"]) {
    assert.ok(source.includes(`\"${asset}\"`), `missing ${asset}`);
  }
  assert.ok(!source.includes('"/kakao.js"'), "legacy Kakao UI asset should not be precached");
});
