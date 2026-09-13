import { requireWorkspaceContext } from "./workspace-context.mjs";

export const USAGE_EVENT_STATUSES = Object.freeze(["success", "failed", "cancelled"]);
export const USAGE_EVENT_SCHEMA_VERSION = "v1";

function text(value, max = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function nonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function integer(value) {
  return Math.round(nonNegative(value));
}

function optionalCost(value) {
  if (value === null || value === undefined || value === "") return null;
  return nonNegative(value);
}

function usageError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requiredIdentifier(value, code, label) {
  const normalized = text(value, 200);
  if (!normalized) throw usageError(code, `${label}가 필요합니다.`);
  return normalized;
}

function normalizeCreatedAt(value, fallback = new Date()) {
  const source = value ?? fallback;
  const date = source instanceof Date ? source : new Date(source);
  if (Number.isNaN(date.getTime())) {
    throw usageError("USAGE_EVENT_CREATED_AT_INVALID", "Usage Event 생성 시각이 올바르지 않습니다.");
  }
  return date.toISOString();
}

function identity(raw, context) {
  const workspaceContext = context?.workspaceContext ?? raw?.workspaceContext;
  if (workspaceContext) {
    const normalized = requireWorkspaceContext(workspaceContext);
    return { userId: normalized.userId, workspaceId: normalized.workspaceId };
  }
  return {
    userId: requiredIdentifier(
      raw?.userId ?? raw?.user_id ?? context?.userId ?? context?.user_id,
      "USAGE_EVENT_USER_REQUIRED",
      "userId",
    ),
    workspaceId: requiredIdentifier(
      raw?.workspaceId ?? raw?.workspace_id ?? context?.workspaceId ?? context?.workspace_id,
      "USAGE_EVENT_WORKSPACE_REQUIRED",
      "workspaceId",
    ),
  };
}

export function buildUsageEventKey(input = {}) {
  const requestId = text(input.requestId ?? input.request_id, 200);
  const service = text(input.service, 80).toLowerCase();
  const providerRequestId = text(input.providerRequestId ?? input.provider_request_id, 200);
  const operation = text(input.operation, 100).toLowerCase();
  const feature = text(input.feature, 100).toLowerCase();
  if (!requestId || !service) {
    throw usageError(
      "USAGE_EVENT_KEY_REQUIRES_REQUEST_AND_SERVICE",
      "Usage Event key에는 requestId와 service가 필요합니다.",
    );
  }
  return [requestId, service, providerRequestId || operation || feature || "event"].join(":");
}

export function normalizeUsageEvent(raw = {}, context = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const owner = identity(source, context);
  const requestId = text(source.requestId ?? source.request_id ?? context.requestId ?? context.request_id, 200);
  const feature = text(source.feature ?? context.feature, 100).toLowerCase();
  const service = text(source.service ?? source.category ?? context.service, 80).toLowerCase();
  const operation = text(source.operation ?? context.operation, 100).toLowerCase();
  const providerRequestId = text(
    source.providerRequestId ?? source.provider_request_id ?? context.providerRequestId,
    200,
  );
  const legacyId = text(source.id, 200);
  const suppliedEventKey = text(source.eventKey ?? source.event_key, 500);
  const eventKey = suppliedEventKey
    || legacyId
    || buildUsageEventKey({ requestId, service, providerRequestId, operation, feature });
  const metadata = source.metadata && typeof source.metadata === "object" && !Array.isArray(source.metadata)
    ? { ...source.metadata }
    : {};
  const legacyUserLabel = text(source.userLabel, 80);
  if (legacyUserLabel && metadata.legacyUserLabel === undefined) metadata.legacyUserLabel = legacyUserLabel;
  if (legacyId && metadata.legacyEventId === undefined) metadata.legacyEventId = legacyId;

  return Object.freeze({
    schemaVersion: USAGE_EVENT_SCHEMA_VERSION,
    eventKey,
    requestId,
    jobId: text(source.jobId ?? source.job_id ?? context.jobId ?? context.job_id, 200),
    userId: owner.userId,
    workspaceId: owner.workspaceId,
    feature,
    service,
    operation,
    provider: text(source.provider, 80).toLowerCase(),
    model: text(source.model, 120),
    audioSeconds: nonNegative(source.audioSeconds ?? source.durationSeconds ?? source.audio_seconds),
    inputTokens: integer(source.inputTokens ?? source.input_tokens),
    outputTokens: integer(source.outputTokens ?? source.output_tokens),
    imageCount: integer(source.imageCount ?? source.image_count),
    storageBytes: integer(source.storageBytes ?? source.storage_bytes),
    apiCalls: integer(source.apiCalls ?? source.api_calls ?? 1),
    nativeCost: nonNegative(source.nativeCost ?? source.native_cost),
    nativeCurrency: text(source.nativeCurrency ?? source.native_currency, 8).toUpperCase() || "KRW",
    estimatedCostKrw: nonNegative(source.estimatedCostKrw ?? source.estimated_cost_krw),
    actualCostKrw: optionalCost(source.actualCostKrw ?? source.actual_cost_krw),
    pricingVersion: text(source.pricingVersion ?? source.pricing_version, 80),
    providerRequestId,
    relatedType: text(source.relatedType ?? source.related_type ?? context.relatedType, 80),
    relatedId: text(source.relatedId ?? source.related_id ?? context.relatedId, 200),
    status: USAGE_EVENT_STATUSES.includes(source.status) ? source.status : "success",
    createdAt: normalizeCreatedAt(source.createdAt ?? source.created_at, context.now ?? new Date()),
    metadata: Object.freeze(metadata),
  });
}

export function createUnconfiguredUsageLedgerAdapter() {
  return Object.freeze({
    configured: false,
    async record() {
      throw usageError("USAGE_LEDGER_NOT_CONFIGURED", "중앙 usage ledger가 아직 연결되지 않았습니다.");
    },
  });
}
