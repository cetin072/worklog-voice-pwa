import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

const html = read("public/index.html");
const app = read("public/app.js");
const styles = read("public/styles.css");
const distribution = read("public/distribution.css");
const authUi = read("public/platform-auth-ui.js");
const onboarding = read("public/onboarding.js");
const settingsHtml = read("public/settings.html");
const settingsJs = read("public/settings.js");
const settingsCss = read("public/settings.css");
const platformAuth = read("public/platform-auth.js");

test("distribution home exposes social preview metadata", () => {
  assert.match(html, /<meta name="description" content="말하거나 입력하면 업무와 일정을 놓치지 않게 정리해주는 개인 업무수첩">/);
  assert.match(html, /<meta property="og:title" content="업무수첩 · 말하면 기록되고 일정까지 한눈에">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/worklog-voice-pwa\.netlify\.app\/icons\/icon-512-v3\.png">/);
  assert.match(html, /<meta name="twitter:card" content="summary">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/worklog-voice-pwa\.netlify\.app\/">/);
});

test("distribution home routes settings to a standalone page", () => {
  assert.match(html, /id="settingsOpen"[^>]*href="\/settings\.html"/);
  assert.doesNotMatch(html, /id="settingsPanel"/);
  assert.doesNotMatch(html, /id="settingsBackdrop"/);
  assert.doesNotMatch(html, /id="settingsClose"/);
  assert.doesNotMatch(html, /id="settingsLogout"/);
  assert.match(settingsHtml, /<h1>⚙ 설정<\/h1>/);
  assert.match(settingsHtml, /class="settings-close" href="\/">완료<\/a>/);
  assert.match(settingsHtml, /id="settingsLogout"/);
});

test("platform explanation is a compact collapsed details card before settings", () => {
  const detailsIndex = settingsHtml.indexOf('id="settingsPlatformAbout"');
  const settingsIndex = settingsHtml.indexOf('class="card settings-card settings-page-card"');
  assert.ok(detailsIndex >= 0 && settingsIndex > detailsIndex);
  assert.match(settingsHtml, /<details id="settingsPlatformAbout"/);
  assert.doesNotMatch(settingsHtml, /<details id="settingsPlatformAbout"[^>]*\sopen/);
  assert.match(settingsHtml, /업무수첩 플랫폼/);
  assert.match(settingsHtml, /현재 기본 기능/);
  assert.match(settingsHtml, /Platform Core/);
  assert.match(settingsHtml, /알림·전달 모듈/);
  assert.match(settingsHtml, /문서·스캔 모듈/);
  assert.match(settingsHtml, /통화·회의 모듈/);
  assert.match(settingsCss, /\.settings-platform-card/);
  assert.match(settingsCss, /\.settings-roadmap/);
});

test("settings defaults briefing open and offers only whole-card collapse", () => {
  assert.match(settingsHtml, /id="settingsBriefingCollapsed"/);
  assert.doesNotMatch(settingsHtml, /settingsBriefingInitialLimit/);
  assert.match(settingsJs, /briefingCollapsed: false/);
  assert.match(settingsJs, /briefingCollapsed: stored\?\.briefingCollapsed === true/);
  assert.doesNotMatch(settingsJs, /briefingInitialLimit/);
});

test("direct input exposes only text and save while keeping inference compatibility hidden", () => {
  const entryStart = html.indexOf('id="entryCard"');
  const entryEnd = html.indexOf("</section>", entryStart);
  const entryMarkup = html.slice(entryStart, entryEnd + "</section>".length);

  assert.ok(entryStart >= 0);
  assert.match(entryMarkup, /<label class="label" for="text">직접 입력<\/label>/);
  assert.match(entryMarkup, /id="typedSave"/);
  assert.match(html, /id="entryCompatibilityFields" hidden aria-hidden="true"/);
  for (const legacyLabel of ["기관", "상태", "업무유형", "금액", "담당자", "기한", "후속조치"]) {
    assert.doesNotMatch(entryMarkup, new RegExp(`>${legacyLabel}<`));
  }
  assert.match(settingsJs, /sanitizeLegacyDraftExtras/);
  assert.match(settingsJs, /amount: "", assignee: "", dueDate: "", followUp: ""/);
});

test("settings exposes a platform-aware install action", () => {
  assert.match(settingsHtml, /id="settingsInstallAction"/);
  assert.match(settingsHtml, /id="settingsInstallGuide"/);
  assert.match(settingsJs, /beforeinstallprompt/);
  assert.match(settingsJs, /promptEvent\.prompt\(\)/);
  assert.match(settingsJs, /iPhone\/iPad 설치/);
  assert.match(settingsJs, /앱 설치/);
});

test("new-user onboarding prefers Platform auth instead of forcing Notion", () => {
  assert.doesNotMatch(onboarding, /onboardingSetup/);
  assert.doesNotMatch(onboarding, /worklogOnboardingSeenV1/);
  assert.doesNotMatch(html, /id="onboardingSetup"/);
  assert.match(html, /id="platformAuthCard"/);
});

test("Google is the primary sign-in action while email remains available", () => {
  assert.match(html, /id="platformGoogleSignIn"/);
  assert.match(html, /Google로 시작/);
  assert.match(html, /또는 이메일로/);
  assert.match(html, /id="platformAuthForm"/);
  assert.ok(html.indexOf('id="platformGoogleSignIn"') < html.indexOf('id="platformAuthForm"'));
});

test("Google OAuth uses Supabase authorize and only persists Supabase session tokens", () => {
  assert.match(platformAuth, /signInWithGoogle/);
  assert.match(platformAuth, /\/auth\/v1\/authorize/);
  assert.match(platformAuth, /provider: "google"/);
  assert.match(platformAuth, /access_token/);
  assert.match(platformAuth, /refresh_token/);
  assert.doesNotMatch(platformAuth, /googleAccessToken/);
  assert.doesNotMatch(platformAuth, /googleRefreshToken/);
});

test("auth UI wires Google sign-in and hides signed-in account card", () => {
  assert.match(authUi, /platformGoogleSignIn/);
  assert.match(authUi, /signInWithGoogle/);
  assert.match(authUi, /card\.hidden = true/);
  assert.match(authUi, /body\?\.classList\.add\("platform-authenticated"\)/);
  assert.match(distribution, /\.platform-authenticated \.platform-auth-card/);
});

test("legacy Kakao connection UI stays hidden until multi-user delivery is ready", () => {
  assert.doesNotMatch(html, /id="kakaoConnect"/);
  assert.doesNotMatch(html, /id="kakaoSendNow"/);
  assert.doesNotMatch(html, /\/kakao\.js/);
});

test("settings owns logout after Platform sign-in", () => {
  assert.match(settingsHtml, /id="settingsLogoutSection"/);
  assert.match(settingsHtml, /id="settingsLogout"/);
  assert.match(settingsJs, /WorklogPlatformAuth\?\.signOut/);
  assert.match(settingsJs, /worklog:platform-auth-changed/);
  assert.doesNotMatch(html, /id="platformSignOut" class="clear" type="button" hidden>로그아웃<\/button>\s*<p[^>]*>[^<]*로그아웃/);
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
