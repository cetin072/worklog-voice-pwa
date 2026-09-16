import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("app startup does not call worklog GET just to render the health badge", () => {
  assert.doesNotMatch(source, /fetch\("\/api\/worklog"\)\s*;/);
  assert.match(source, /fetch\("\/api\/worklog",\{\s*method:"POST"/);
});

test("health badge derives from local session and auth state events", () => {
  assert.match(source, /function syncHealthFromAuth\(event\)/);
  assert.match(source, /WorklogPlatformAuth\?\.readSession\?\.\(\)/);
  assert.match(source, /worklog:platform-auth-changed/);
  assert.match(source, /platform-signed-in/);
  assert.match(source, /platform-signed-out/);
  assert.match(source, /platform-legacy-user/);
  assert.match(source, /로그인 필요/);
  assert.match(source, /연결됨/);
});
