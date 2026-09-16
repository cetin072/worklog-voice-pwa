import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  randomBytes,
  sign,
} from "node:crypto";

function pushError(code, message, status = 0) {
  const error = new Error(message);
  error.code = code;
  if (status) error.status = status;
  return error;
}

function b64urlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function b64urlDecode(value, code) {
  try {
    const input = String(value || "").trim();
    if (!input) throw new Error("EMPTY");
    return Buffer.from(input, "base64url");
  } catch {
    throw pushError(code, "Web Push key 형식이 올바르지 않습니다.");
  }
}

function hmac(key, data) {
  return createHmac("sha256", key).update(data).digest();
}

function hkdfExpand(prk, info, length) {
  if (!Number.isInteger(length) || length < 1 || length > 32) {
    throw pushError("WEB_PUSH_HKDF_LENGTH_INVALID", "Web Push HKDF 길이가 올바르지 않습니다.");
  }
  return hmac(prk, Buffer.concat([Buffer.from(info), Buffer.from([1])])).subarray(0, length);
}

function validateSubscription(subscription) {
  if (!subscription || typeof subscription !== "object" || Array.isArray(subscription)) {
    throw pushError("WEB_PUSH_SUBSCRIPTION_INVALID", "Push 구독 정보가 올바르지 않습니다.");
  }
  let endpoint;
  try {
    endpoint = new URL(String(subscription.endpoint || ""));
  } catch {
    throw pushError("WEB_PUSH_ENDPOINT_INVALID", "Push endpoint가 올바르지 않습니다.");
  }
  if (endpoint.protocol !== "https:") {
    throw pushError("WEB_PUSH_ENDPOINT_INVALID", "Push endpoint는 HTTPS여야 합니다.");
  }
  const clientPublic = b64urlDecode(subscription.p256dh, "WEB_PUSH_P256DH_INVALID");
  const authSecret = b64urlDecode(subscription.auth, "WEB_PUSH_AUTH_INVALID");
  if (clientPublic.length !== 65 || clientPublic[0] !== 4) {
    throw pushError("WEB_PUSH_P256DH_INVALID", "Push P-256 공개키가 올바르지 않습니다.");
  }
  if (authSecret.length !== 16) {
    throw pushError("WEB_PUSH_AUTH_INVALID", "Push 인증 비밀값이 올바르지 않습니다.");
  }
  return { endpoint, clientPublic, authSecret };
}

function validateVapid(publicKey, privateKey, subject) {
  const publicRaw = b64urlDecode(publicKey, "WEB_PUSH_VAPID_PUBLIC_INVALID");
  const privateRaw = b64urlDecode(privateKey, "WEB_PUSH_VAPID_PRIVATE_INVALID");
  if (publicRaw.length !== 65 || publicRaw[0] !== 4 || privateRaw.length !== 32) {
    throw pushError("WEB_PUSH_VAPID_INVALID", "VAPID key가 올바르지 않습니다.");
  }
  let subjectUrl;
  try {
    subjectUrl = new URL(String(subject || ""));
  } catch {
    throw pushError("WEB_PUSH_VAPID_SUBJECT_INVALID", "VAPID subject가 올바르지 않습니다.");
  }
  if (!["https:", "mailto:"].includes(subjectUrl.protocol)) {
    throw pushError("WEB_PUSH_VAPID_SUBJECT_INVALID", "VAPID subject는 HTTPS 또는 mailto URI여야 합니다.");
  }
  return { publicRaw, privateRaw, subject: subjectUrl.toString() };
}

function generateServerPrivateKey() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return ecdh.getPrivateKey();
}

export function deriveWebPushKeys({ clientPublic, authSecret, serverPrivate, salt }) {
  const client = Buffer.from(clientPublic);
  const auth = Buffer.from(authSecret);
  const privateRaw = Buffer.from(serverPrivate);
  const saltRaw = Buffer.from(salt);
  if (client.length !== 65 || client[0] !== 4 || auth.length !== 16 || privateRaw.length !== 32 || saltRaw.length !== 16) {
    throw pushError("WEB_PUSH_KEY_INPUT_INVALID", "Web Push key derivation 입력이 올바르지 않습니다.");
  }

  const ecdh = createECDH("prime256v1");
  try {
    ecdh.setPrivateKey(privateRaw);
  } catch {
    throw pushError("WEB_PUSH_SERVER_KEY_INVALID", "Web Push 일회용 서버 키가 올바르지 않습니다.");
  }
  const serverPublic = ecdh.getPublicKey(null, "uncompressed");
  let sharedSecret;
  try {
    sharedSecret = ecdh.computeSecret(client);
  } catch {
    throw pushError("WEB_PUSH_CLIENT_KEY_INVALID", "구독 공개키를 검증하지 못했습니다.");
  }

  const prkKey = hmac(auth, sharedSecret);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info", "ascii"), Buffer.from([0]), client, serverPublic]);
  const ikm = hkdfExpand(prkKey, keyInfo, 32);
  const prk = hmac(saltRaw, ikm);
  const cek = hkdfExpand(prk, Buffer.concat([Buffer.from("Content-Encoding: aes128gcm", "ascii"), Buffer.from([0])]), 16);
  const nonce = hkdfExpand(prk, Buffer.concat([Buffer.from("Content-Encoding: nonce", "ascii"), Buffer.from([0])]), 12);
  return Object.freeze({ serverPublic, cek, nonce });
}

export function encryptWebPushPayload({ subscription, payload, salt = randomBytes(16), serverPrivate = null }) {
  const { clientPublic, authSecret } = validateSubscription(subscription);
  const plain = Buffer.from(String(payload ?? ""), "utf8");
  if (plain.length > 3993) {
    throw pushError("WEB_PUSH_PAYLOAD_TOO_LARGE", "Web Push payload가 너무 큽니다.");
  }
  const saltRaw = Buffer.from(salt);
  if (saltRaw.length !== 16) throw pushError("WEB_PUSH_SALT_INVALID", "Web Push salt가 올바르지 않습니다.");
  const privateRaw = serverPrivate ? Buffer.from(serverPrivate) : generateServerPrivateKey();

  const { serverPublic, cek, nonce } = deriveWebPushKeys({
    clientPublic,
    authSecret,
    serverPrivate: privateRaw,
    salt: saltRaw,
  });

  const plaintext = Buffer.concat([plain, Buffer.from([2])]);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096, 0);
  const header = Buffer.concat([saltRaw, recordSize, Buffer.from([serverPublic.length]), serverPublic]);
  const body = Buffer.concat([header, ciphertext]);
  if (body.length > 4096) throw pushError("WEB_PUSH_BODY_TOO_LARGE", "암호화된 Web Push body가 너무 큽니다.");
  return Object.freeze({ body, serverPublic, cek, nonce });
}

export function createVapidJwt({ endpoint, publicKey, privateKey, subject, now = Date.now() }) {
  const { publicRaw, privateRaw, subject: normalizedSubject } = validateVapid(publicKey, privateKey, subject);
  let audience;
  try {
    audience = new URL(String(endpoint || "")).origin;
  } catch {
    throw pushError("WEB_PUSH_ENDPOINT_INVALID", "Push endpoint가 올바르지 않습니다.");
  }

  const header = b64urlEncode(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const body = b64urlEncode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Number(now) / 1000) + (12 * 60 * 60),
    sub: normalizedSubject,
  }));
  const signingInput = `${header}.${body}`;
  const x = b64urlEncode(publicRaw.subarray(1, 33));
  const y = b64urlEncode(publicRaw.subarray(33, 65));
  const d = b64urlEncode(privateRaw);
  const key = createPrivateKey({ key: { kty: "EC", crv: "P-256", x, y, d }, format: "jwk" });
  const signature = sign("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${b64urlEncode(signature)}`;
}

export async function sendWebPush({
  subscription,
  payload,
  vapidPublicKey,
  vapidPrivateKey,
  vapidSubject,
  fetchImpl = fetch,
  now = Date.now(),
} = {}) {
  if (typeof fetchImpl !== "function") throw pushError("WEB_PUSH_FETCH_REQUIRED", "Web Push fetch 구현이 필요합니다.");
  const { endpoint } = validateSubscription(subscription);
  const encrypted = encryptWebPushPayload({ subscription, payload });
  const token = createVapidJwt({ endpoint: endpoint.toString(), publicKey: vapidPublicKey, privateKey: vapidPrivateKey, subject: vapidSubject, now });

  const response = await fetchImpl(endpoint.toString(), {
    method: "POST",
    headers: {
      authorization: `vapid t=${token}, k=${vapidPublicKey}`,
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: "60",
    },
    body: encrypted.body,
  });

  if (!response.ok) {
    const error = pushError("WEB_PUSH_DELIVERY_FAILED", `Push 서비스가 ${response.status} 상태를 반환했습니다.`, response.status);
    error.expired = response.status === 404 || response.status === 410;
    throw error;
  }
  return Object.freeze({ ok: true, status: response.status });
}
