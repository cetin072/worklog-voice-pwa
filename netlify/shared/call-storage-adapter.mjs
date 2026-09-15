import { normalizeProcessingJob } from "./platform/processing-job.mjs";
import {
  TEMP_STORAGE_MAX_RETENTION_HOURS,
  effectiveTemporaryStorageExpiry,
  normalizePreparedStorageObject,
} from "./platform/storage-boundary.mjs";

function storageAdapterError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function rawText(value) {
  return String(value ?? "").trim();
}

function normalizeObservedAt(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) {
    throw storageAdapterError("CALL_STORAGE_OBSERVED_AT_INVALID", "통화 임시 음성 확인 시각이 올바르지 않습니다.");
  }
  return date;
}

function requireCallJob(jobInput) {
  const job = normalizeProcessingJob(jobInput || {});
  if (job.kind !== "call") {
    throw storageAdapterError("CALL_PROCESSING_JOB_REQUIRED", "통화 Storage adapter에는 kind=call Processing Job이 필요합니다.");
  }
  return job;
}

function configuredStorageAdapter(adapter) {
  if (!adapter || typeof adapter !== "object" || adapter.configured !== true) {
    throw storageAdapterError("STORAGE_NOT_CONFIGURED", "연결된 Platform Storage adapter가 필요합니다.");
  }
  if (typeof adapter.verifyPreparedUpload !== "function") {
    throw storageAdapterError("STORAGE_VERIFY_NOT_CONFIGURED", "Platform Storage verifyPreparedUpload가 필요합니다.");
  }
  return adapter;
}

export function normalizeCallPreparedAudio(verifiedInput = {}, context = {}) {
  const job = requireCallJob(context.job);
  const prepared = normalizePreparedStorageObject(verifiedInput);
  const effectiveExpiresAt = effectiveTemporaryStorageExpiry(prepared, {
    maxRetentionHours: context.maxRetentionHours ?? TEMP_STORAGE_MAX_RETENTION_HOURS,
  });

  const observedAt = normalizeObservedAt(context.now);
  if (new Date(effectiveExpiresAt) <= observedAt) {
    throw storageAdapterError("CALL_PREPARED_AUDIO_EXPIRED", "검증된 통화 임시 음성의 보존시간이 만료되었습니다.");
  }

  const sourceAudioRef = Object.freeze({
    sourceId: prepared.uploadId,
    objectPath: prepared.objectPath,
  });

  return Object.freeze({
    jobId: job.jobId,
    requestId: job.requestId,
    userId: job.userId,
    workspaceId: job.workspaceId,
    uploadId: prepared.uploadId,
    objectPath: prepared.objectPath,
    uploadedAt: prepared.uploadedAt,
    sourceExpiresAt: prepared.expiresAt,
    effectiveExpiresAt,
    sizeBytes: prepared.sizeBytes,
    mimeType: prepared.mimeType,
    fileName: prepared.fileName,
    storageMetadata: prepared.metadata,
    sourceAudioRef,
  });
}

export async function verifyCallPreparedAudio(storageAdapterInput, input = {}, context = {}) {
  const storageAdapter = configuredStorageAdapter(storageAdapterInput);
  const job = requireCallJob(input.job ?? context.job);
  const preparedUpload = input.preparedUpload;

  if (!preparedUpload || typeof preparedUpload !== "object" || Array.isArray(preparedUpload)) {
    throw storageAdapterError("CALL_PREPARED_UPLOAD_REQUIRED", "검증할 preparedUpload가 필요합니다.");
  }

  const requestedUploadId = rawText(preparedUpload.uploadId ?? preparedUpload.upload_id);
  if (!requestedUploadId) {
    throw storageAdapterError("CALL_PREPARED_UPLOAD_ID_REQUIRED", "preparedUpload.uploadId가 필요합니다.");
  }

  const verified = await storageAdapter.verifyPreparedUpload(Object.freeze({
    job,
    preparedUpload,
  }));

  const normalized = normalizeCallPreparedAudio(verified, {
    ...context,
    job,
  });

  if (requestedUploadId !== normalized.uploadId) {
    throw storageAdapterError(
      "CALL_STORAGE_VERIFICATION_MISMATCH",
      "요청한 uploadId와 서버 검증 결과가 일치하지 않습니다.",
    );
  }

  return normalized;
}
