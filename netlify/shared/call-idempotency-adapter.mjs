import {
  buildIdempotencyKey,
  isValidIdempotencyRequestId,
  normalizeIdempotencyContext,
} from "./platform/idempotency.mjs";

const CALL_PLATFORM_SCOPE = "call.process";
const PLATFORM_REQUEST_ID_PREFIX = "call-";
const PLATFORM_REQUEST_ID_MAX_SOURCE_BYTES = 47;

function callIdempotencyError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function rawText(value) {
  return String(value ?? "").trim();
}

function requireCallRequestId(value) {
  const requestId = rawText(value);
  if (!requestId) {
    throw callIdempotencyError("CALL_REQUEST_ID_REQUIRED", "통화 처리 requestId가 필요합니다.");
  }
  return requestId;
}

function requireCallFingerprint(value) {
  const fingerprint = rawText(value);
  if (!fingerprint) {
    throw callIdempotencyError("CALL_IDEMPOTENCY_KEY_REQUIRED", "통화 파일 fingerprint idempotencyKey가 필요합니다.");
  }
  return fingerprint;
}

function utf8Hex(value) {
  return Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The Call domain keeps its attempt ID (for example `req_<timestamp>_<nonce>`),
 * while Platform requires a restricted request-id alphabet. Hex encoding preserves
 * the exact attempt identifier without using it as the deduplication identity.
 */
export function buildPlatformRequestIdFromCallRequestId(value) {
  const callRequestId = requireCallRequestId(value);
  const encoded = new TextEncoder().encode(callRequestId);
  if (encoded.length > PLATFORM_REQUEST_ID_MAX_SOURCE_BYTES) {
    throw callIdempotencyError(
      "CALL_REQUEST_ID_TOO_LONG_FOR_PLATFORM",
      "통화 처리 requestId가 Platform 호환 길이를 초과합니다.",
    );
  }
  const requestId = `${PLATFORM_REQUEST_ID_PREFIX}${utf8Hex(callRequestId)}`;
  if (!isValidIdempotencyRequestId(requestId)) {
    throw callIdempotencyError("CALL_PLATFORM_REQUEST_ID_INVALID", "Platform 호환 requestId를 만들 수 없습니다.");
  }
  return requestId;
}

/**
 * Thin Call → Platform boundary. The domain fingerprint remains the canonical
 * deduplication input; the request ID continues to identify one processing attempt.
 */
export function buildCallPlatformIdempotency(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const callRequestId = requireCallRequestId(source.requestId ?? source.callRequestId);
  const idempotencyKey = requireCallFingerprint(source.idempotencyKey);
  const platformInput = {
    scope: source.scope ?? CALL_PLATFORM_SCOPE,
    requestId: buildPlatformRequestIdFromCallRequestId(callRequestId),
    idempotencyKey,
    workspaceContext: source.workspaceContext,
  };
  const context = normalizeIdempotencyContext(platformInput);
  return Object.freeze({
    callRequestId,
    ...context,
    canonicalKey: buildIdempotencyKey(platformInput),
  });
}
