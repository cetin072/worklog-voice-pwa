import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createPublicKey, verify } from "node:crypto";
import {
  createVapidJwt,
  deriveWebPushKeys,
  encryptWebPushPayload,
  sendWebPush,
} from "../netlify/shared/web-push.mjs";

const RFC = Object.freeze({
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  clientPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  serverPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  serverPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  cek: "oIhVW04MRdy2XN9CiKLxTg",
  nonce: "4h_95klXJ5E_qnoN",
  plaintext: "When I grow up, I want to be a watermelon",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
});

const raw = (value) => Buffer.from(value, "base64url");

test("RFC 8291 vector derives the standard CEK and nonce", () => {
  const keys = deriveWebPushKeys({
    clientPublic: raw(RFC.clientPublic),
    authSecret: raw(RFC.auth),
    serverPrivate: raw(RFC.serverPrivate),
    salt: raw(RFC.salt),
  });

  assert.equal(keys.serverPublic.toString("base64url"), RFC.serverPublic);
  assert.equal(keys.cek.toString("base64url"), RFC.cek);
  assert.equal(keys.nonce.toString("base64url"), RFC.nonce);
});

test("RFC 8291 vector encrypts to the documented aes128gcm body", () => {
  const encrypted = encryptWebPushPayload({
    subscription: {
      endpoint: "https://push.example.net/push/example",
      p256dh: RFC.clientPublic,
      auth: RFC.auth,
    },
    payload: RFC.plaintext,
    salt: raw(RFC.salt),
    serverPrivate: raw(RFC.serverPrivate),
  });

  assert.equal(encrypted.body.toString("base64url"), RFC.body);
});

test("VAPID JWT uses push-service origin and valid ES256 signature", () => {
  const now = Date.UTC(2026, 8, 16, 0, 0, 0);
  const jwt = createVapidJwt({
    endpoint: "https://push.example.net/push/example",
    publicKey: RFC.serverPublic,
    privateKey: RFC.serverPrivate,
    subject: "https://worklog.example/",
    now,
  });
  const [headerPart, payloadPart, signaturePart] = jwt.split(".");
  const header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8"));
  const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  assert.deepEqual(header, { typ: "JWT", alg: "ES256" });
  assert.equal(payload.aud, "https://push.example.net");
  assert.equal(payload.sub, "https://worklog.example/");
  assert.equal(payload.exp, Math.floor(now / 1000) + 43200);

  const pub = raw(RFC.serverPublic);
  const key = createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: pub.subarray(1, 33).toString("base64url"),
      y: pub.subarray(33, 65).toString("base64url"),
    },
    format: "jwk",
  });
  assert.equal(verify("sha256", Buffer.from(`${headerPart}.${payloadPart}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(signaturePart, "base64url")), true);
});

test("server Web Push uses VAPID and aes128gcm without a paid provider SDK", async () => {
  let captured = null;
  const result = await sendWebPush({
    subscription: {
      endpoint: "https://push.example.net/push/example",
      p256dh: RFC.clientPublic,
      auth: RFC.auth,
    },
    payload: JSON.stringify({ title: "업무수첩", body: "test" }),
    vapidPublicKey: RFC.serverPublic,
    vapidPrivateKey: RFC.serverPrivate,
    vapidSubject: "https://worklog.example/",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response("", { status: 201 });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(captured.url, "https://push.example.net/push/example");
  assert.equal(captured.options.headers["content-encoding"], "aes128gcm");
  assert.match(captured.options.headers.authorization, /^vapid t=.+, k=/);
  assert.ok(Buffer.from(captured.options.body).length > 86);
});

test("expired Push endpoint is marked for subscription cleanup", async () => {
  await assert.rejects(
    () => sendWebPush({
      subscription: { endpoint: "https://push.example.net/push/expired", p256dh: RFC.clientPublic, auth: RFC.auth },
      payload: "test",
      vapidPublicKey: RFC.serverPublic,
      vapidPrivateKey: RFC.serverPrivate,
      vapidSubject: "https://worklog.example/",
      fetchImpl: async () => new Response("", { status: 410 }),
    }),
    (error) => error?.code === "WEB_PUSH_DELIVERY_FAILED" && error?.expired === true && error?.status === 410,
  );
});

test("Push subscription migration is user/workspace owned and RLS protected", () => {
  const sql = fs.readFileSync("supabase/migrations/20260916084500_push_subscriptions_v1.sql", "utf8");
  assert.match(sql, /create table if not exists public\.push_subscriptions/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /user_id = \(select auth\.uid\(\)\)/);
  assert.match(sql, /private\.can_access_workspace/);
  assert.match(sql, /unique \(user_id, endpoint\)/);
});

test('ephemeral P-256 scalar is padded when OpenSSL omits leading zero octets', () => {
  const source = fs.readFileSync('netlify/shared/web-push.mjs', 'utf8');
  const body = source.match(/function generateServerPrivateKey\(\) \{([\s\S]*?)\n\}/)[1];
  for (const size of [1, 31, 32]) {
    const rawKey = Buffer.alloc(size, 1); // synthetic scalar, never an installed key
    const generate = new Function('createECDH', 'Buffer', body);
    const actual = generate(() => ({ generateKeys() {}, getPrivateKey: () => rawKey }), Buffer);
    assert.equal(actual.length, 32);
    assert.deepEqual(actual.subarray(32 - size), rawKey);
    assert.deepEqual(actual.subarray(0, 32 - size), Buffer.alloc(32 - size));
    const keys = deriveWebPushKeys({ clientPublic: raw(RFC.clientPublic), authSecret: raw(RFC.auth), serverPrivate: actual, salt: raw(RFC.salt) });
    assert.equal(keys.cek.length, 16);
  }
});
