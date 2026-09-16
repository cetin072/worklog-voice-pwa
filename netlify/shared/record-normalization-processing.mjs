import { buildIdempotencyKey } from "./platform/idempotency.mjs";
import { normalizeProcessingJob } from "./platform/processing-job.mjs";
import { runProcessingStages } from "./platform/processing-runner.mjs";
import { createRetryPlan } from "./platform/retry-plan.mjs";

export const RECORD_NORMALIZATION_STAGE_NAMES = Object.freeze(["normalizing", "persisting"]);

function processingError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createRecordNormalizationPlatformJob(input = {}, context = {}) {
  const existing = input.existingJob;
  if (existing && typeof existing === "object" && !Array.isArray(existing) && existing.jobId) {
    const job = normalizeProcessingJob(existing);
    if (job.kind !== "record_normalization") {
      throw processingError("RECORD_NORMALIZATION_JOB_KIND_INVALID", "기록 정제 Processing Job kind가 올바르지 않습니다.");
    }
    return job;
  }

  const workspaceContext = input.workspaceContext ?? context.workspaceContext;
  const requestId = String(input.requestId || "").trim();
  const workRecordId = String(input.workRecordId || "").trim();
  if (!requestId || !workRecordId) {
    throw processingError("RECORD_NORMALIZATION_JOB_INPUT_REQUIRED", "기록 정제 Job에는 requestId와 workRecordId가 필요합니다.");
  }
  const canonicalKey = buildIdempotencyKey({
    scope: "record-normalization",
    requestId,
    idempotencyKey: `work_record:${workRecordId}`,
    workspaceContext,
  });

  return normalizeProcessingJob({
    jobId: `record-normalization-${workRecordId}`,
    requestId,
    idempotencyKey: canonicalKey,
    workspaceContext,
    kind: "record_normalization",
    operation: "normalize",
    status: "queued",
    metadata: { workRecordId },
  }, { now: context.now });
}

function requireHandler(handlers, name) {
  const handler = handlers?.[name];
  if (typeof handler !== "function") {
    throw processingError("RECORD_NORMALIZATION_STAGE_HANDLER_REQUIRED", `${name} stage handler가 필요합니다.`);
  }
  return handler;
}

export function buildRecordNormalizationStages(handlers = {}) {
  return [
    Object.freeze({ name: "normalizing", checkpointKey: "normalized", run: requireHandler(handlers, "normalizing") }),
    Object.freeze({ name: "persisting", checkpointKey: "persisted", run: requireHandler(handlers, "persisting") }),
  ];
}

export async function runRecordNormalizationProcessing(input = {}, deps = {}) {
  const job = createRecordNormalizationPlatformJob({
    existingJob: input.job,
    requestId: input.requestId,
    workRecordId: input.workRecordId,
    workspaceContext: input.workspaceContext,
  }, { now: deps.now?.() });
  return runProcessingStages({
    job,
    payload: input.payload ?? {},
    stages: buildRecordNormalizationStages(input.handlers),
  }, deps);
}

export function createRecordNormalizationRetryPlan(job, at = new Date()) {
  return createRetryPlan(job, {
    maxAttempts: 3,
    backoffMs: [0, 60_000, 120_000],
    retryableErrorCodes: [
      "SUPABASE_DATA_CORE_UPDATE_FAILED",
      "SUPABASE_DATA_CORE_SELECT_FAILED",
      "TypeError",
      "NETWORK_ERROR",
    ],
  }, at);
}
