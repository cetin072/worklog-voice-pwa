const POLICY_KEY = "worklog.callProcessing.policy.v1";

export const TRANSCRIPT_RETENTION = Object.freeze({
  KEEP: "keep",
  THIRTY_DAYS: "30d",
  DELETE_AFTER_SUMMARY: "delete_after_summary",
});

export const DEFAULT_CALL_PROCESSING_POLICY = Object.freeze({
  failedTempRetentionHours: 6,
  maxTempRetentionHours: 24,
  transcriptRetention: TRANSCRIPT_RETENTION.KEEP,
  originalAudioPermanentStorage: false,
  paidProcessingLocked: true,
});

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeCallProcessingPolicy(value = {}) {
  const maxTempRetentionHours = Math.min(
    24,
    Math.max(1, Math.round(finiteNumber(value.maxTempRetentionHours, DEFAULT_CALL_PROCESSING_POLICY.maxTempRetentionHours))),
  );
  const failedTempRetentionHours = Math.min(
    maxTempRetentionHours,
    Math.max(1, Math.round(finiteNumber(value.failedTempRetentionHours, DEFAULT_CALL_PROCESSING_POLICY.failedTempRetentionHours))),
  );
  const transcriptRetention = Object.values(TRANSCRIPT_RETENTION).includes(value.transcriptRetention)
    ? value.transcriptRetention
    : DEFAULT_CALL_PROCESSING_POLICY.transcriptRetention;

  return {
    failedTempRetentionHours,
    maxTempRetentionHours,
    transcriptRetention,
    originalAudioPermanentStorage: false,
    paidProcessingLocked: true,
  };
}

export function loadCallProcessingPolicy(storage = globalThis.localStorage) {
  if (!storage) return { ...DEFAULT_CALL_PROCESSING_POLICY };
  try {
    const raw = storage.getItem(POLICY_KEY);
    return normalizeCallProcessingPolicy(raw ? JSON.parse(raw) : {});
  } catch {
    return { ...DEFAULT_CALL_PROCESSING_POLICY };
  }
}

export function saveCallProcessingPolicy(policy, storage = globalThis.localStorage) {
  const normalized = normalizeCallProcessingPolicy(policy);
  if (storage) storage.setItem(POLICY_KEY, JSON.stringify(normalized));
  return normalized;
}

export function tempAudioDisposition(status, at = new Date(), policy = DEFAULT_CALL_PROCESSING_POLICY) {
  const normalized = normalizeCallProcessingPolicy(policy);
  const time = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(time.getTime())) throw new TypeError("유효한 처리 시각이 필요합니다.");

  if (status === "completed") {
    return { deleteImmediately: true, deleteAfter: time.toISOString() };
  }

  if (["failed", "retry_wait"].includes(status)) {
    const deleteAt = new Date(time.getTime() + normalized.failedTempRetentionHours * 3600_000);
    const absoluteMax = new Date(time.getTime() + normalized.maxTempRetentionHours * 3600_000);
    return {
      deleteImmediately: false,
      deleteAfter: new Date(Math.min(deleteAt.getTime(), absoluteMax.getTime())).toISOString(),
    };
  }

  return { deleteImmediately: false, deleteAfter: null };
}

export function transcriptDeleteAfter(createdAt = new Date(), policy = DEFAULT_CALL_PROCESSING_POLICY) {
  const normalized = normalizeCallProcessingPolicy(policy);
  const time = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(time.getTime())) throw new TypeError("유효한 생성 시각이 필요합니다.");

  if (normalized.transcriptRetention === TRANSCRIPT_RETENTION.KEEP) return null;
  if (normalized.transcriptRetention === TRANSCRIPT_RETENTION.DELETE_AFTER_SUMMARY) return time.toISOString();
  return new Date(time.getTime() + 30 * 24 * 3600_000).toISOString();
}

function fnv1a32(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function buildCallProcessingFingerprint(input = {}) {
  const normalized = [
    String(input.userKey || "anonymous").trim().toLowerCase(),
    String(input.fileName || "").trim(),
    Math.max(0, Math.round(finiteNumber(input.fileSize, 0))),
    Math.max(0, Math.round(finiteNumber(input.lastModified, 0))),
    String(input.kind || "call"),
    String(input.pipelineVersion || "v1"),
  ].join("|");
  return `call_${fnv1a32(normalized)}`;
}

export function createProcessingRequest(input = {}, now = new Date()) {
  const time = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(time.getTime())) throw new TypeError("유효한 요청 시각이 필요합니다.");
  const fingerprint = buildCallProcessingFingerprint(input);
  const nonce = Math.random().toString(36).slice(2, 10);
  return {
    requestId: `req_${time.getTime()}_${nonce}`,
    idempotencyKey: fingerprint,
    kind: input.kind === "meeting" ? "meeting" : "call",
    createdAt: time.toISOString(),
  };
}

if (typeof document !== "undefined") {
  void import("./call-analysis-preview.mjs");
}
