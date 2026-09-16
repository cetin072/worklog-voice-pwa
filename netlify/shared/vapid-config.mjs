import { createECDH } from "node:crypto";

function decodeBase64Url(value) {
  const input = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(input)) return null;
  try {
    const raw = Buffer.from(input, "base64url");
    return raw.length === 32 ? raw : null;
  } catch {
    return null;
  }
}

export function deriveVapidPublicKey(privateKey) {
  const privateRaw = decodeBase64Url(privateKey);
  if (!privateRaw) return "";
  try {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(privateRaw);
    return ecdh.getPublicKey(null, "uncompressed").toString("base64url");
  } catch {
    return "";
  }
}

export function vapidConfigFromEnv(getEnv) {
  const read = typeof getEnv === "function" ? getEnv : () => undefined;
  const privateKey = String(read("WEB_PUSH_VAPID_PRIVATE_KEY") || "").trim();
  const subject = String(read("WEB_PUSH_VAPID_SUBJECT") || "").trim();
  const publicKey = deriveVapidPublicKey(privateKey);

  let subjectValid = false;
  try {
    const url = new URL(subject);
    subjectValid = url.protocol === "https:" || url.protocol === "mailto:";
  } catch {}

  return Object.freeze({
    configured: Boolean(publicKey && subjectValid),
    publicKey,
    privateKey,
    subject,
  });
}
