export const PROCESSING_STATUSES = Object.freeze([
  "queued",
  "uploading",
  "transcribing",
  "analyzing",
  "persisting",
  "cleanup_pending",
  "completed",
  "retry_wait",
  "failed",
  "cancelled",
]);

const TRANSITIONS = Object.freeze({
  queued: new Set(["uploading", "cancelled", "failed"]),
  uploading: new Set(["transcribing", "retry_wait", "failed", "cancelled"]),
  transcribing: new Set(["analyzing", "retry_wait", "failed", "cancelled"]),
  analyzing: new Set(["persisting", "retry_wait", "failed", "cancelled"]),
  persisting: new Set(["cleanup_pending", "retry_wait", "failed"]),
  cleanup_pending: new Set(["completed", "failed"]),
  retry_wait: new Set(["uploading", "transcribing", "analyzing", "persisting", "failed", "cancelled"]),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
});

export function canTransitionProcessingStatus(from, to) {
  return Boolean(TRANSITIONS[from]?.has(to));
}

export function transitionProcessingJob(job, nextStatus, at = new Date()) {
  if (!job || typeof job !== "object") throw new TypeError("processing job이 필요합니다.");
  if (!PROCESSING_STATUSES.includes(job.status)) throw new Error(`알 수 없는 현재 상태: ${job.status}`);
  if (!PROCESSING_STATUSES.includes(nextStatus)) throw new Error(`알 수 없는 다음 상태: ${nextStatus}`);
  if (!canTransitionProcessingStatus(job.status, nextStatus)) {
    throw new Error(`허용되지 않은 상태 전환: ${job.status} -> ${nextStatus}`);
  }
  const time = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(time.getTime())) throw new TypeError("유효한 상태 변경 시각이 필요합니다.");
  return {
    ...job,
    status: nextStatus,
    updatedAt: time.toISOString(),
    finishedAt: ["completed", "failed", "cancelled"].includes(nextStatus) ? time.toISOString() : job.finishedAt || null,
  };
}
