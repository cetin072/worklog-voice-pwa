import { requireWorkspaceContext } from "./workspace-context.mjs";

export const PROCESSING_JOB_SCHEMA_VERSION = "v1";
export const PROCESSING_JOB_STATUSES = Object.freeze([
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
]);

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const TRANSITIONS = Object.freeze({
  queued: new Set(["processing", "failed", "cancelled"]),
  processing: new Set(["processing", "completed", "failed", "cancelled"]),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
});
const TOKEN_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/;

function jobError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function rawText(value) {
  return String(value ?? "").trim();
}

function requiredIdentifier(value, requiredCode, invalidCode, label) {
  const normalized = rawText(value);
  if (!normalized) throw jobError(requiredCode, `${label}가 필요합니다.`);
  if (normalized.length > 200) throw jobError(invalidCode, `${label}가 허용 길이를 초과했습니다.`);
  return normalized;
}

function optionalBoundedIdentifier(value, max, invalidCode, label) {
  const normalized = rawText(value);
  if (!normalized) return "";
  if (normalized.length > max) throw jobError(invalidCode, `${label}가 허용 길이를 초과했습니다.`);
  return normalized;
}

function optionalText(value, max) {
  return rawText(value).slice(0, max);
}

function normalizeToken(value, code, label, required = false) {
  const normalized = rawText(value).toLowerCase();
  if (!normalized) {
    if (required) throw jobError(`${code}_REQUIRED`, `${label}가 필요합니다.`);
    return "";
  }
  if (!TOKEN_PATTERN.test(normalized)) throw jobError(`${code}_INVALID`, `${label} 형식이 올바르지 않습니다.`);
  return normalized;
}

function normalizeDate(value, fallback, code) {
  const source = value ?? fallback;
  const date = source instanceof Date ? source : new Date(source);
  if (Number.isNaN(date.getTime())) throw jobError(code, "Processing Job 시각이 올바르지 않습니다.");
  return date.toISOString();
}

function normalizeOptionalDate(value, code) {
  if (value === null || value === undefined || value === "") return null;
  return normalizeDate(value, undefined, code);
}

function normalizeOwner(source, context) {
  const workspaceContext = context?.workspaceContext ?? source?.workspaceContext;
  if (workspaceContext) {
    const owner = requireWorkspaceContext(workspaceContext);
    return { userId: owner.userId, workspaceId: owner.workspaceId };
  }
  return {
    userId: requiredIdentifier(
      source?.userId ?? source?.user_id ?? context?.userId ?? context?.user_id,
      "PROCESSING_JOB_USER_REQUIRED",
      "PROCESSING_JOB_USER_INVALID",
      "userId",
    ),
    workspaceId: requiredIdentifier(
      source?.workspaceId ?? source?.workspace_id ?? context?.workspaceId ?? context?.workspace_id,
      "PROCESSING_JOB_WORKSPACE_REQUIRED",
      "PROCESSING_JOB_WORKSPACE_INVALID",
      "workspaceId",
    ),
  };
}

function nonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.round(number);
}

function frozenRecord(value) {
  return Object.freeze(value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {});
}

function assertMutableJob(job) {
  if (TERMINAL_STATUSES.has(job.status)) {
    throw jobError("PROCESSING_JOB_TERMINAL_IMMUTABLE", "종료된 Processing Job은 변경할 수 없습니다.");
  }
}

export function canTransitionProcessingJobStatus(from, to) {
  return Boolean(TRANSITIONS[from]?.has(to));
}

export function normalizeProcessingJob(raw = {}, context = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const owner = normalizeOwner(source, context);
  const status = rawText(source.status || "queued").toLowerCase();
  if (!PROCESSING_JOB_STATUSES.includes(status)) {
    throw jobError("PROCESSING_JOB_STATUS_INVALID", "Processing Job status가 올바르지 않습니다.");
  }
  const stage = normalizeToken(source.stage, "PROCESSING_JOB_STAGE", "stage");
  if (status === "processing" && !stage) {
    throw jobError("PROCESSING_JOB_STAGE_REQUIRED", "processing 상태에는 stage가 필요합니다.");
  }
  const createdAt = normalizeDate(
    source.createdAt ?? source.created_at,
    context.now ?? new Date(),
    "PROCESSING_JOB_CREATED_AT_INVALID",
  );
  const updatedAt = normalizeDate(
    source.updatedAt ?? source.updated_at,
    createdAt,
    "PROCESSING_JOB_UPDATED_AT_INVALID",
  );

  return Object.freeze({
    schemaVersion: PROCESSING_JOB_SCHEMA_VERSION,
    jobId: requiredIdentifier(
      source.jobId ?? source.job_id ?? source.id,
      "PROCESSING_JOB_ID_REQUIRED",
      "PROCESSING_JOB_ID_INVALID",
      "jobId",
    ),
    requestId: requiredIdentifier(
      source.requestId ?? source.request_id,
      "PROCESSING_JOB_REQUEST_ID_REQUIRED",
      "PROCESSING_JOB_REQUEST_ID_INVALID",
      "requestId",
    ),
    idempotencyKey: optionalBoundedIdentifier(
      source.idempotencyKey ?? source.idempotency_key,
      500,
      "PROCESSING_JOB_IDEMPOTENCY_KEY_INVALID",
      "idempotencyKey",
    ),
    userId: owner.userId,
    workspaceId: owner.workspaceId,
    kind: normalizeToken(source.kind, "PROCESSING_JOB_KIND", "kind", true),
    operation: normalizeToken(source.operation, "PROCESSING_JOB_OPERATION", "operation"),
    status,
    stage,
    attemptCount: nonNegativeInteger(source.attemptCount ?? source.attempt_count),
    checkpoints: frozenRecord(source.checkpoints),
    errorCode: optionalText(source.errorCode ?? source.error_code, 100),
    errorMessage: optionalText(source.errorMessage ?? source.error_message, 1000),
    createdAt,
    updatedAt,
    finishedAt: normalizeOptionalDate(
      source.finishedAt ?? source.finished_at,
      "PROCESSING_JOB_FINISHED_AT_INVALID",
    ),
    metadata: frozenRecord(source.metadata),
  });
}

export function transitionProcessingJob(job, next = {}, at = new Date()) {
  const current = normalizeProcessingJob(job);
  const nextStatus = rawText(next.status).toLowerCase();
  if (!PROCESSING_JOB_STATUSES.includes(nextStatus)) {
    throw jobError("PROCESSING_JOB_STATUS_INVALID", "다음 Processing Job status가 올바르지 않습니다.");
  }
  if (!canTransitionProcessingJobStatus(current.status, nextStatus)) {
    throw jobError(
      "PROCESSING_JOB_TRANSITION_INVALID",
      `허용되지 않은 Processing Job 전환: ${current.status} -> ${nextStatus}`,
    );
  }
  const time = normalizeDate(at, undefined, "PROCESSING_JOB_UPDATED_AT_INVALID");
  const stage = next.stage === undefined
    ? current.stage
    : normalizeToken(next.stage, "PROCESSING_JOB_STAGE", "stage");
  if (nextStatus === "processing" && !stage) {
    throw jobError("PROCESSING_JOB_STAGE_REQUIRED", "processing 상태에는 stage가 필요합니다.");
  }

  return normalizeProcessingJob({
    ...current,
    status: nextStatus,
    stage,
    errorCode: next.errorCode ?? (nextStatus === "processing" || nextStatus === "completed" ? "" : current.errorCode),
    errorMessage: next.errorMessage ?? (nextStatus === "processing" || nextStatus === "completed" ? "" : current.errorMessage),
    updatedAt: time,
    finishedAt: TERMINAL_STATUSES.has(nextStatus) ? time : null,
  });
}

export function setProcessingCheckpoint(job, name, value, at = new Date()) {
  const current = normalizeProcessingJob(job);
  assertMutableJob(current);
  const checkpointName = normalizeToken(name, "PROCESSING_JOB_CHECKPOINT", "checkpoint", true);
  const time = normalizeDate(at, undefined, "PROCESSING_JOB_UPDATED_AT_INVALID");
  return normalizeProcessingJob({
    ...current,
    checkpoints: { ...current.checkpoints, [checkpointName]: value },
    updatedAt: time,
  });
}

export function clearProcessingCheckpoint(job, name, at = new Date()) {
  const current = normalizeProcessingJob(job);
  assertMutableJob(current);
  const checkpointName = normalizeToken(name, "PROCESSING_JOB_CHECKPOINT", "checkpoint", true);
  const checkpoints = { ...current.checkpoints };
  delete checkpoints[checkpointName];
  const time = normalizeDate(at, undefined, "PROCESSING_JOB_UPDATED_AT_INVALID");
  return normalizeProcessingJob({ ...current, checkpoints, updatedAt: time });
}

export function incrementProcessingAttempt(job, at = new Date()) {
  const current = normalizeProcessingJob(job);
  assertMutableJob(current);
  const time = normalizeDate(at, undefined, "PROCESSING_JOB_UPDATED_AT_INVALID");
  return normalizeProcessingJob({
    ...current,
    attemptCount: current.attemptCount + 1,
    updatedAt: time,
  });
}

export function createUnconfiguredProcessingJobStoreAdapter() {
  const fail = async () => {
    throw jobError("PROCESSING_JOB_STORE_NOT_CONFIGURED", "Processing Job store가 아직 연결되지 않았습니다.");
  };
  return Object.freeze({ configured: false, get: fail, save: fail });
}
