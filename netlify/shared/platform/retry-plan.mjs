import { normalizeProcessingJob } from "./processing-job.mjs";

export const RETRY_PLAN_SCHEMA_VERSION = "v1";
export const RETRY_PLAN_STATUSES = Object.freeze(["scheduled", "exhausted", "not_retryable"]);
const MAX_DELAY_MS = 86_400_000;

function retryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function rawText(value) {
  return String(value ?? "").trim();
}

function validDate(value, code) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw retryError(code, "Retry 시각이 올바르지 않습니다.");
  return date;
}

export function normalizeRetryPolicy(raw = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const maxAttempts = Number(source.maxAttempts);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    throw retryError("RETRY_POLICY_MAX_ATTEMPTS_INVALID", "maxAttempts는 1~20 정수여야 합니다.");
  }

  if (!Array.isArray(source.backoffMs) || source.backoffMs.length === 0) {
    throw retryError("RETRY_POLICY_BACKOFF_REQUIRED", "backoffMs 배열이 필요합니다.");
  }
  if (source.backoffMs.length > 20) {
    throw retryError("RETRY_POLICY_BACKOFF_INVALID", "backoffMs는 최대 20개까지만 허용됩니다.");
  }
  const backoffMs = source.backoffMs.map((value) => {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0 || number > MAX_DELAY_MS) {
      throw retryError("RETRY_POLICY_BACKOFF_INVALID", "backoffMs는 0~24시간 정수(ms)여야 합니다.");
    }
    return number;
  });

  const rawCodes = source.retryableErrorCodes ?? [];
  if (!Array.isArray(rawCodes)) {
    throw retryError("RETRY_POLICY_ERROR_CODES_INVALID", "retryableErrorCodes는 배열이어야 합니다.");
  }
  const retryableErrorCodes = [];
  for (const value of rawCodes) {
    const code = rawText(value);
    if (!code) continue;
    if (code.length > 100) {
      throw retryError("RETRY_POLICY_ERROR_CODES_INVALID", "retryable error code가 허용 길이를 초과했습니다.");
    }
    if (!retryableErrorCodes.includes(code)) retryableErrorCodes.push(code);
  }

  return Object.freeze({
    maxAttempts,
    backoffMs: Object.freeze(backoffMs),
    retryableErrorCodes: Object.freeze(retryableErrorCodes),
  });
}

export function createRetryPlan(jobInput, policyInput, at = new Date()) {
  const job = normalizeProcessingJob(jobInput);
  if (job.status !== "processing") {
    throw retryError("RETRY_JOB_NOT_PROCESSING", "processing 상태 Job만 retry plan을 만들 수 있습니다.");
  }
  if (!job.errorCode && !job.errorMessage) {
    throw retryError("RETRY_JOB_ERROR_REQUIRED", "retry plan에는 현재 Job 오류가 필요합니다.");
  }

  const policy = normalizeRetryPolicy(policyInput);
  const now = validDate(at, "RETRY_PLAN_CREATED_AT_INVALID");
  let status = "scheduled";
  let reason = "retry_scheduled";
  let delayMs = 0;
  let retryAt = null;

  if (job.attemptCount >= policy.maxAttempts) {
    status = "exhausted";
    reason = "max_attempts_reached";
  } else if (
    policy.retryableErrorCodes.length > 0
    && !policy.retryableErrorCodes.includes(job.errorCode)
  ) {
    status = "not_retryable";
    reason = "error_code_not_retryable";
  } else {
    const index = Math.max(0, Math.min(policy.backoffMs.length - 1, job.attemptCount - 1));
    delayMs = policy.backoffMs[index];
    retryAt = new Date(now.getTime() + delayMs).toISOString();
  }

  return Object.freeze({
    schemaVersion: RETRY_PLAN_SCHEMA_VERSION,
    status,
    reason,
    jobId: job.jobId,
    stage: job.stage,
    attemptCount: job.attemptCount,
    maxAttempts: policy.maxAttempts,
    delayMs,
    retryAt,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    createdAt: now.toISOString(),
  });
}

export function isRetryPlanDue(plan, at = new Date()) {
  if (!plan || plan.status !== "scheduled" || !plan.retryAt) return false;
  const retryAt = validDate(plan.retryAt, "RETRY_PLAN_RETRY_AT_INVALID");
  const now = validDate(at, "RETRY_PLAN_CHECK_AT_INVALID");
  return now >= retryAt;
}

export function createUnconfiguredRetrySchedulerAdapter() {
  const fail = async () => {
    throw retryError("RETRY_SCHEDULER_NOT_CONFIGURED", "Retry scheduler가 아직 연결되지 않았습니다.");
  };
  return Object.freeze({ configured: false, schedule: fail, cancel: fail });
}
