import { runProcessingStages } from "./platform/processing-runner.mjs";
import { createRetryPlan } from "./platform/retry-plan.mjs";
import { normalizeProcessingJob } from "./platform/processing-job.mjs";

const CALL_STAGE_SEQUENCE = Object.freeze([
  Object.freeze({ name: "uploading", checkpointKey: "uploading" }),
  Object.freeze({ name: "transcribing", checkpointKey: "transcript" }),
  Object.freeze({ name: "analyzing", checkpointKey: "analysis" }),
  Object.freeze({ name: "persisting", checkpointKey: "persisted" }),
  Object.freeze({ name: "cleanup", checkpointKey: "cleanup" }),
]);

function callRetryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireCallJob(jobInput) {
  const job = normalizeProcessingJob(jobInput);
  if (job.kind !== "call") {
    throw callRetryError("CALL_PROCESSING_JOB_REQUIRED", "통화 Processing Job이 필요합니다.");
  }
  return job;
}

function requireHandler(handlers, name) {
  const handler = handlers?.[name];
  if (typeof handler !== "function") {
    throw callRetryError("CALL_PROCESSING_STAGE_HANDLER_REQUIRED", `${name} stage handler가 필요합니다.`);
  }
  return handler;
}

export function buildCallPlatformStages(handlers = {}) {
  return CALL_STAGE_SEQUENCE.map(({ name, checkpointKey }) => Object.freeze({
    name,
    checkpointKey,
    run: requireHandler(handlers, name),
  }));
}

export async function runCallPlatformProcessing(input = {}, deps = {}) {
  const job = requireCallJob(input.job);
  return runProcessingStages({
    job,
    payload: input.payload ?? {},
    stages: buildCallPlatformStages(input.handlers),
  }, deps);
}

export function createCallPlatformRetryPlan(jobInput, options = {}, at = new Date()) {
  const job = requireCallJob(jobInput);
  if (job.status !== "processing") {
    throw callRetryError("CALL_RETRY_JOB_NOT_PROCESSING", "재시도 판단 대상 통화 Job은 processing 상태여야 합니다.");
  }
  if (!job.stage) {
    throw callRetryError("CALL_RETRY_STAGE_REQUIRED", "재시도할 통화 stage가 필요합니다.");
  }
  if (!job.errorCode && !job.errorMessage) {
    throw callRetryError("CALL_RETRY_ERROR_REQUIRED", "재시도 판단에 통화 처리 오류가 필요합니다.");
  }

  const retryableErrorCodes = options.retryableErrorCodes;
  if (!Array.isArray(retryableErrorCodes)) {
    throw callRetryError(
      "CALL_RETRYABLE_ERROR_CODES_REQUIRED",
      "통화 모듈이 retryableErrorCodes를 명시해 재시도 가능 오류를 결정해야 합니다.",
    );
  }

  return createRetryPlan(job, {
    maxAttempts: options.maxAttempts ?? 3,
    backoffMs: options.backoffMs ?? [0, 30_000, 120_000],
    retryableErrorCodes,
  }, at);
}

export const CALL_PLATFORM_STAGE_NAMES = Object.freeze(CALL_STAGE_SEQUENCE.map((item) => item.name));
