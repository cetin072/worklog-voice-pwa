import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const readBytes = (path) => readFileSync(new URL(`../${path}`, import.meta.url));

function pngSize(path) {
  const bytes = readBytes(path);
  assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test("system launch and the 1.5-second in-app brand screen share one v6 brand icon", () => {
  const html = read("public/index.html");
  const css = read("public/distribution.css");
  const manifest = JSON.parse(read("public/manifest.webmanifest"));

  assert.match(html, /class="eyebrow welcome-eyebrow">말하면 기록되고, 일정까지 한눈에<\/p>/);
  assert.match(html, /distribution\.css\?v=20260917-2/);
  assert.match(html, /rel="preload" as="image" href="\/icons\/icon-512-v6\.png"/);
  assert.match(html, /name="theme-color" content="#ffffff"/);
  assert.equal(manifest.background_color, "#ffffff");
  assert.equal(manifest.theme_color, "#ffffff");
  assert.ok(manifest.icons.some((icon) => icon.src === "/icons/icon-192-v6.png"));
  assert.ok(manifest.icons.some((icon) => icon.src === "/icons/icon-512-v6.png" && icon.purpose.split(/\s+/).includes("maskable")));
  assert.equal(manifest.icons.filter((icon) => icon.purpose.split(/\s+/).includes("maskable")).length, 1);
  assert.match(css, /body\.platform-auth-loading \.welcome-card\{[^}]*position:fixed/);
  assert.match(css, /body\.platform-auth-loading \.welcome-card\{[^}]*inset:0/);
  assert.match(css, /body\.platform-auth-loading \.welcome-card\{[^}]*background:#fff/);
  assert.match(css, /body\.platform-auth-loading \.welcome-icon\{[^}]*\/icons\/icon-512-v6\.png/);
  assert.doesNotMatch(css, /body\.platform-auth-loading \.welcome-icon\{display:none\}/);
  assert.match(css, /body\.platform-auth-loading \.welcome-card h2::after\{[^}]*content:"업무수첩"/);
  assert.match(css, /body\.platform-auth-loading \.welcome-card h2::after\{[^}]*animation:brand-copy-rise/);
  assert.match(css, /body\.platform-auth-loading \.welcome-eyebrow::before\{content:"말하면 기록되고,"\}/);
  assert.match(css, /body\.platform-auth-loading \.welcome-eyebrow::after\{content:"일정까지 한눈에"/);
  assert.match(css, /@keyframes brand-copy-rise/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /body\.platform-auth-loading \.welcome-copy,body\.platform-auth-loading \.welcome-benefits\{display:none\}/);
  assert.match(css, /body:not\(\.platform-auth-loading\)\.platform-session-hint \.welcome-card/);
});

test("v6 PWA icons keep exact native sizes while the same 512 asset can be maskable", () => {
  assert.deepEqual(pngSize("public/icons/icon-192-v6.png"), { width: 192, height: 192 });
  assert.deepEqual(pngSize("public/icons/icon-512-v6.png"), { width: 512, height: 512 });
});

test("brand splash remains visible for 1.5 seconds after first paint while initialization continues", () => {
  const source = read("public/platform-auth-ui.js");
  const scheduleStart = source.indexOf("function scheduleBrandLaunchRelease()");
  const scheduleEnd = source.indexOf("scheduleBrandLaunchRelease();", scheduleStart);
  const schedule = source.slice(scheduleStart, scheduleEnd);
  const stateStart = source.indexOf("function setAuthState");
  const stateEnd = source.indexOf("function legacyMode", stateStart);
  const setAuthState = source.slice(stateStart, stateEnd);

  assert.match(source, /const BRAND_LAUNCH_HOLD_MS = 1500/);
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
