import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { deriveVapidPublicKey, vapidConfigFromEnv } from "../netlify/shared/vapid-config.mjs";

const PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
const PUBLIC = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";

test("VAPID public key is derived from the private key", () => {
  assert.equal(deriveVapidPublicKey(PRIVATE), PUBLIC);
});

test("VAPID config uses private key as source of truth and ignores stale public env", () => {
  const values = {
    WEB_PUSH_VAPID_PRIVATE_KEY: PRIVATE,
    WEB_PUSH_VAPID_PUBLIC_KEY: "stale-public-key",
    WEB_PUSH_VAPID_SUBJECT: "https://worklog.example/",
  };
  const config = vapidConfigFromEnv((name) => values[name]);
  assert.equal(config.configured, true);
  assert.equal(config.publicKey, PUBLIC);
  assert.equal(config.privateKey, PRIVATE);
});

test("invalid VAPID private key fails closed", () => {
  const config = vapidConfigFromEnv((name) => ({
    WEB_PUSH_VAPID_PRIVATE_KEY: "invalid",
    WEB_PUSH_VAPID_SUBJECT: "https://worklog.example/",
  })[name]);
  assert.equal(config.configured, false);
  assert.equal(config.publicKey, "");
});

test("public subscription endpoint never serializes the VAPID private key", () => {
  const source = fs.readFileSync("netlify/functions/push-subscription.mts", "utf8");
  assert.match(source, /vapidConfigFromEnv/);
  assert.match(source, /publicKey:config\.publicKey/);
  assert.doesNotMatch(source, /json\([^\n]*privateKey/);
});
