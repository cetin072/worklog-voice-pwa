import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("push delivery diagnostics persist status and code", () => {
  const migration = fs.readFileSync("supabase/migrations/20260916023500_push_subscription_delivery_diagnostics_v1.sql", "utf8");
  const immediate = fs.readFileSync("netlify/functions/push-test.mts", "utf8");
  const closed = fs.readFileSync("netlify/functions/push-test-closed-background.mts", "utf8");
  assert.match(migration, /last_failure_status/);
  assert.match(migration, /last_failure_code/);
  assert.match(immediate, /last_failure_status:status \|\| null/);
  assert.match(immediate, /last_failure_code:code/);
  assert.match(closed, /last_failure_status:status \|\| null/);
  assert.match(closed, /last_failure_code:code/);
  assert.match(closed, /background:true/);
});

test("closed-app test runs immediate server preflight before scheduling background delivery", () => {
  const settings = fs.readFileSync("public/push-settings.js", "utf8");
  const immediateIndex = settings.indexOf("sendServerTestPush()");
  const closedIndex = settings.indexOf("scheduleClosedAppServerPushTest()");
  assert.ok(immediateIndex >= 0);
  assert.ok(closedIndex > immediateIndex);
  assert.match(settings, /1차 서버 전송 성공/);
});
