import { buildCallPlatformIdempotency } from "./call-idempotency-adapter.mjs";
import { normalizeProcessingJob } from "./platform/processing-job.mjs";

function metadataRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
}

/**
 * Creates a Platform-owned Processing Job without promoting Call's detailed
 * processing stages into the Platform status vocabulary.
 */
export function createCallPlatformProcessingJob(input = {}, context = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const idempotency = buildCallPlatformIdempotency({
    requestId: source.requestId ?? source.callRequestId,
    idempotencyKey: source.idempotencyKey,
    workspaceContext: source.workspaceContext ?? context.workspaceContext,
    scope: source.scope,
  });

  return normalizeProcessingJob({
    jobId: source.jobId ?? source.job_id ?? source.id,
    requestId: idempotency.requestId,
    idempotencyKey: idempotency.canonicalKey,
    workspaceContext: source.workspaceContext ?? context.workspaceContext,
    kind: "call",
    operation: "process",
    status: "queued",
    createdAt: source.createdAt ?? source.created_at,
    updatedAt: source.updatedAt ?? source.updated_at,
    metadata: {
      ...metadataRecord(source.metadata),
      callRequestId: idempotency.callRequestId,
      callFingerprint: idempotency.idempotencyKey,
    },
  }, { now: context.now });
}
