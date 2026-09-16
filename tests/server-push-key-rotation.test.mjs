import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("client replaces an existing Push subscription when the VAPID public key changes", () => {
  const notifications = fs.readFileSync("public/notifications.js", "utf8");
  assert.match(notifications, /subscriptionMatchesServerKey/);
  assert.match(notifications, /subscription\.unsubscribe\(\)/);
  assert.match(notifications, /applicationServerKey:\s*base64UrlToUint8Array\(config\.publicKey\)/);
});

test("closed-app Push test is explicitly deployed as a Netlify background function", () => {
  const closedFn = fs.readFileSync("netlify/functions/push-test-closed-background.mts", "utf8");
  assert.match(closedFn, /background:true/);
  assert.match(closedFn, /method:"POST"/);
  assert.match(closedFn, /setTimeout\(resolve,8000\)/);
});
