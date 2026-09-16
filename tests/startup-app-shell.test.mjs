import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("startup loading state uses a white centered brand launch splash", () => {
  const html = read("public/index.html");
  const css = read("public/distribution.css");

  assert.match(html, /class="eyebrow welcome-eyebrow">말하면 기록되고, 일정까지 한눈에<\/p>/);
  assert.match(css, /body\.platform-auth-loading \.welcome-card\{[^}]*position:fixed/);
  assert.match(css, /body\.platform-auth-loading \.welcome-card\{[^}]*inset:0/);
  assert.match(css, /body\.platform-auth-loading \.welcome-card\{[^}]*background:#fff/);
  assert.match(css, /body\.platform-auth-loading \.welcome-icon\{[^}]*\/icons\/icon-192-v3\.png/);
  assert.match(css, /body\.platform-auth-loading \.welcome-card h2::after\{[^}]*content:"업무수첩"/);
  assert.match(css, /body\.platform-auth-loading \.welcome-card h2::after\{[^}]*color:#111827/);
  assert.match(css, /body\.platform-auth-loading \.welcome-eyebrow\{[^}]*font-size:24px/);
  assert.match(css, /body\.platform-auth-loading \.welcome-copy,body\.platform-auth-loading \.welcome-benefits\{display:none\}/);
  assert.match(css, /body:not\(\.platform-auth-loading\)\.platform-session-hint \.welcome-card/);
});

test("brand splash remains visible for one second after first paint while initialization continues", () => {
  const source = read("public/platform-auth-ui.js");
  const scheduleStart = source.indexOf("function scheduleBrandLaunchRelease()");
  const scheduleEnd = source.indexOf("scheduleBrandLaunchRelease();", scheduleStart);
  const schedule = source.slice(scheduleStart, scheduleEnd);
  const stateStart = source.indexOf("function setAuthState");
  const stateEnd = source.indexOf("function legacyMode", stateStart);
  const setAuthState = source.slice(stateStart, stateEnd);

  assert.match(source, /const BRAND_LAUNCH_HOLD_MS = 1000/);
  assert.match(schedule, /requestAnimationFrame/);
  assert.match(schedule, /setTimeout\(release, BRAND_LAUNCH_HOLD_MS\)/);
  assert.doesNotMatch(schedule, /fetch\s*\(/);
  assert.doesNotMatch(setAuthState, /platform-auth-loading/);
  assert.match(source, /scheduleBrandLaunchRelease\(\);[\s\S]*applyLocalAuthHint\(\);[\s\S]*refresh\(\)\.catch/);
});

test("existing local Platform session still prepares the core shell before remote auth verification", () => {
  const source = read("public/platform-auth-ui.js");
  const hintIndex = source.indexOf("applyLocalAuthHint();");
  const refreshIndex = source.indexOf("refresh().catch", hintIndex);
  assert.ok(hintIndex >= 0, "local auth hint must run during startup");
  assert.ok(refreshIndex > hintIndex, "remote auth verification must run after the local shell hint");
  assert.match(source, /WorklogPlatformAuth\.readSession\?\.\(\)/);
  assert.match(source, /session\?\.access_token/);
  assert.match(source, /classList\.add\("platform-session-hint"\)/);
  assert.match(source, /setAuthState\("platform-signed-in", user\)/);
});

test("local session hint is UI-only and does not skip currentUser server verification", () => {
  const source = read("public/platform-auth-ui.js");
  assert.match(source, /const user = await window\.WorklogPlatformAuth\.currentUser\(\)/);
  assert.match(source, /if \(!user\)/);
  assert.match(source, /setAuthState\("platform-signed-out"\)/);
  assert.doesNotMatch(source, /return\s+session\?\.access_token\s*;\s*\/\/\s*authenticated/i);
});
