import { requireWorkspaceContext } from "./workspace-context.mjs";

export const IDEMPOTENCY_SCHEMA_VERSION = "v1";
export const IDEMPOTENCY_REQUIRED_CONSISTENCY = "strong";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{16,100}$/;
const SCOPE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/;

function idempotencyError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function rawText(value) {
  return String(value ?? "").trim();
}

export function isValidIdempotencyRequestId(value) {
  return REQUEST_ID_PATTERN.test(String(value || ""));
}

export function normalizeIdempotencyScope(value) {
  const scope = rawText(value).toLowerCase();
  if (!scope) {
    throw idempotencyError("IDEMPOTENCY_SCOPE_REQUIRED", "Idempotency scope가 필요합니다.");
  }
  if (!SCOPE_PATTERN.test(scope)) {
    throw idempotencyError("IDEMPOTENCY_SCOPE_INVALID", "Idempotency scope 형식이 올바르지 않습니다.");
  }
  return scope;
}

function requireRequestId(value) {
  const requestId = rawText(value);
  if (!requestId) {
    throw idempotencyError("IDEMPOTENCY_REQUEST_ID_REQUIRED", "requestId가 필요합니다.");
  }
  if (!isValidIdempotencyRequestId(requestId)) {
    throw idempotencyError("IDEMPOTENCY_REQUEST_ID_INVALID", "requestId 형식이 올바르지 않습니다.");
  }
  return requestId;
}

function optionalOwner(source) {
  if (!source.workspaceContext) return { userId: "", workspaceId: "" };
  const context = requireWorkspaceContext(source.workspaceContext);
  return { userId: context.userId, workspaceId: context.workspaceId };
}

export function normalizeIdempotencyContext(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const owner = optionalOwner(source);
  return Object.freeze({
    schemaVersion: IDEMPOTENCY_SCHEMA_VERSION,
    scope: normalizeIdempotencyScope(source.scope),
    requestId: requireRequestId(source.requestId ?? source.clientRequestId),
    userId: owner.userId,
    workspaceId: owner.workspaceId,
  });
}

function keyPart(value) {
  return encodeURIComponent(String(value));
}

export function buildIdempotencyKey(input = {}) {
  const context = normalizeIdempotencyContext(input);
  const owner = context.workspaceId
    ? `workspace:${keyPart(context.workspaceId)}:user:${keyPart(context.userId)}`
    : "legacy";
  return `idem:${IDEMPOTENCY_SCHEMA_VERSION}:${keyPart(context.scope)}:${owner}:request:${context.requestId}`;
}

export function buildLegacyWorklogIdempotencyKey(value) {
  const requestId = requireRequestId(value);
  return `request:${requestId}`;
}

function normalizeDate(value, fallback, code) {
  const source = value ?? fallback;
  const date = source instanceof Date ? source : new Date(source);
  if (Number.isNaN(date.getTime())) {
    throw idempotencyError(code, "Idempotency record 시각이 올바르지 않습니다.");
  }
  return date.toISOString();
}

export function normalizeCompletedIdempotencyRecord(raw = {}, context = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const normalizedContext = normalizeIdempotencyContext({
    scope: source.scope ?? context.scope,
    requestId: source.requestId ?? source.clientRequestId ?? context.requestId ?? context.clientRequestId,
    workspaceContext: context.workspaceContext ?? source.workspaceContext,
  });
  const result = source.result ?? context.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw idempotencyError(
      "IDEMPOTENCY_RESULT_REQUIRED",
      "완료된 Idempotency record에는 result 객체가 필요합니다.",
    );
  }
  const completedAt = normalizeDate(
    source.completedAt ?? source.completed_at ?? source.createdAt ?? source.created_at,
    context.now ?? new Date(),
    "IDEMPOTENCY_COMPLETED_AT_INVALID",
  );

  return Object.freeze({
    ...normalizedContext,
    status: "completed",
    completedAt,
    result: Object.freeze({ ...result }),
  });
}

export function createUnconfiguredIdempotencyStoreAdapter() {
  const fail = async () => {
    throw idempotencyError(
      "IDEMPOTENCY_STORE_NOT_CONFIGURED",
      "Idempotency store가 아직 연결되지 않았습니다.",
    );
  };

  return Object.freeze({
    configured: false,
    consistency: IDEMPOTENCY_REQUIRED_CONSISTENCY,
    get: fail,
    put: fail,
  });
}
