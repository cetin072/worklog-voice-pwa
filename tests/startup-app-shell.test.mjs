import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("startup loading state keeps a visible welcome shell instead of hiding the whole app", () => {
  const css = read("public/distribution.css");
  assert.match(css, /body\.platform-auth-loading \.core-app-card\{display:none\}/);
  assert.doesNotMatch(css, /body\.platform-auth-loading \.welcome-card[^\n]*visibility:hidden/);
  assert.doesNotMatch(css, /body\.platform-auth-loading[^\n]*\.core-app-card[^\n]*visibility:hidden/);
});

test("existing local Platform session reveals the core shell before remote auth verification", () => {
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
