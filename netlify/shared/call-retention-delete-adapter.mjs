import { normalizeProcessingJob } from "./platform/processing-job.mjs";
import { normalizeStorageObjectPath } from "./platform/storage-boundary.mjs";
import { normalizeRetentionDeleteState } from "./platform/retention-delete.mjs";
import { requireWorkspaceContext } from "./platform/workspace-context.mjs";

function cleanupError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function rawText(value) {
  return String(value ?? "").trim();
}

function observedAt(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) {
    throw cleanupError("CALL_CLEANUP_TIME_INVALID", "임시음성 삭제 시각이 올바르지 않습니다.");
  }
  return date.toISOString();
}

function callJob(jobInput) {
  const job = normalizeProcessingJob(jobInput || {});
  if (job.kind !== "call") {
    throw cleanupError("CALL_PROCESSING_JOB_REQUIRED", "통화 cleanup에는 kind=call Processing Job이 필요합니다.");
  }
  return job;
}

function configuredStorageAdapter(adapter) {
  if (!adapter || typeof adapter !== "object" || adapter.configured !== true) {
    throw cleanupError("STORAGE_NOT_CONFIGURED", "연결된 Platform Storage adapter가 필요합니다.");
  }
  if (typeof adapter.deleteObject !== "function") {
    throw cleanupError("STORAGE_DELETE_NOT_CONFIGURED", "Platform Storage deleteObject가 필요합니다.");
  }
  return adapter;
}

function authorizedWorkspaceContext(context, job) {
  const input = context?.workspaceContext;
  if (!input) {
    throw cleanupError(
      "CALL_CLEANUP_WORKSPACE_CONTEXT_REQUIRED",
      "임시음성 삭제에는 현재 Workspace 권한 문맥이 필요합니다.",
    );
  }
  const owner = requireWorkspaceContext(input);
  if (owner.userId !== job.userId || owner.workspaceId !== job.workspaceId) {
    throw cleanupError(
      "CALL_CLEANUP_WORKSPACE_CONTEXT_MISMATCH",
      "현재 Workspace 권한 문맥이 Processing Job 소유권과 일치하지 않습니다.",
    );
  }
  return owner;
}

function cleanupTarget(preparedAudioInput, job) {
  const source = preparedAudioInput && typeof preparedAudioInput === "object" && !Array.isArray(preparedAudioInput)
    ? preparedAudioInput
    : {};
  const uploadId = rawText(source.uploadId);
  if (!uploadId) throw cleanupError("CALL_CLEANUP_UPLOAD_ID_REQUIRED", "verified uploadId가 필요합니다.");
  const objectPath = normalizeStorageObjectPath(source.objectPath);
  const effectiveExpiresAt = observedAt(source.effectiveExpiresAt);

  const ownership = {
    jobId: rawText(source.jobId),
    requestId: rawText(source.requestId),
    userId: rawText(source.userId),
    workspaceId: rawText(source.workspaceId),
  };
  if (
    ownership.jobId !== job.jobId
    || ownership.requestId !== job.requestId
    || ownership.userId !== job.userId
    || ownership.workspaceId !== job.workspaceId
  ) {
    throw cleanupError("CALL_CLEANUP_OWNERSHIP_MISMATCH", "verified audio와 Processing Job 소유권이 일치하지 않습니다.");
  }

  return Object.freeze({
    uploadId,
    objectPath,
    effectiveExpiresAt,
    sourceAudioRef: Object.freeze({ sourceId: uploadId, objectPath }),
  });
}

function retentionState(job, target, workspaceContext, fields = {}) {
  return normalizeRetentionDeleteState({
    recordType: "call_audio",
    recordId: target.uploadId,
    retentionPolicy: "temporary_audio",
    expiresAt: target.effectiveExpiresAt,
    deleteStatus: fields.deleteStatus || "none",
    deleteRequestedAt: fields.deleteRequestedAt,
    deleteCompletedAt: fields.deleteCompletedAt,
    deleteErrorCode: fields.deleteErrorCode,
    deleteErrorMessage: fields.deleteErrorMessage,
    metadata: {
      jobId: job.jobId,
      requestId: job.requestId,
      cleanupAttempt: Number(fields.cleanupAttempt || 0),
    },
  }, { workspaceContext });
}

function errorInfo(error) {
  return {
    code: rawText(error?.code || error?.name || "TEMP_AUDIO_DELETE_FAILED").slice(0, 100),
    message: rawText(error?.message || "임시음성 삭제에 실패했습니다.").slice(0, 1000),
  };
}

async function performDelete(storageAdapterInput, input = {}, context = {}, retry = false) {
  const storageAdapter = configuredStorageAdapter(storageAdapterInput);
  const job = callJob(input.job);
  const target = cleanupTarget(input.preparedAudio, job);
  const workspaceContext = authorizedWorkspaceContext(context, job);
  const prior = input.retentionState || null;

  if (retry) {
    const normalizedPrior = normalizeRetentionDeleteState(prior || {}, { workspaceContext });
    if (normalizedPrior.recordType !== "call_audio" || normalizedPrior.recordId !== target.uploadId) {
      throw cleanupError("CALL_CLEANUP_RETRY_TARGET_MISMATCH", "재시도 Retention 대상이 verified audio와 다릅니다.");
    }
    if (normalizedPrior.userId !== job.userId || normalizedPrior.workspaceId !== job.workspaceId) {
      throw cleanupError("CALL_CLEANUP_RETRY_OWNERSHIP_MISMATCH", "재시도 Retention 소유권이 Processing Job과 다릅니다.");
    }
    if (normalizedPrior.deleteStatus !== "failed") {
      throw cleanupError("CALL_CLEANUP_RETRY_STATE_INVALID", "삭제 재시도는 failed 상태에서만 가능합니다.");
    }
  }

  const requestedAt = observedAt(context.now);
  const attempt = retry
    ? Number(prior?.metadata?.cleanupAttempt || 1) + 1
    : 1;
  const requested = retentionState(job, target, workspaceContext, {
    deleteStatus: "requested",
    deleteRequestedAt: requestedAt,
    cleanupAttempt: attempt,
  });

  try {
    await storageAdapter.deleteObject(Object.freeze({
      job,
      uploadId: target.uploadId,
      objectPath: target.objectPath,
      sourceAudioRef: target.sourceAudioRef,
    }));
    const completedAt = observedAt(context.completedAt ?? context.now);
    const completed = retentionState(job, target, workspaceContext, {
      deleteStatus: "completed",
      deleteRequestedAt: requested.deleteRequestedAt,
      deleteCompletedAt: completedAt,
      cleanupAttempt: attempt,
    });
    return Object.freeze({ deleted: true, target, retentionState: completed });
  } catch (error) {
    const info = errorInfo(error);
    const failed = retentionState(job, target, workspaceContext, {
      deleteStatus: "failed",
      deleteRequestedAt: requested.deleteRequestedAt,
      deleteErrorCode: info.code,
      deleteErrorMessage: info.message,
      cleanupAttempt: attempt,
    });
    return Object.freeze({ deleted: false, target, retentionState: failed, error: Object.freeze(info) });
  }
}

export function createCallTemporaryAudioRetention(input = {}, context = {}) {
  const job = callJob(input.job);
  const target = cleanupTarget(input.preparedAudio, job);
  const workspaceContext = authorizedWorkspaceContext(context, job);
  return retentionState(job, target, workspaceContext);
}

export async function deleteCallTemporaryAudio(storageAdapter, input = {}, context = {}) {
  return performDelete(storageAdapter, input, context, false);
}

export async function retryCallTemporaryAudioDelete(storageAdapter, input = {}, context = {}) {
  return performDelete(storageAdapter, input, context, true);
}
