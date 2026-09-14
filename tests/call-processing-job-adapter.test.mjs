import test from "node:test";
import assert from "node:assert/strict";

import { createCallPlatformProcessingJob } from "../netlify/shared/call-processing-job-adapter.mjs";
import { transitionProcessingJob } from "../netlify/shared/platform/processing-job.mjs";

const workspaceContext = { userId: "user-1", workspaceId: "workspace-1", role: "owner" };
const now = "2026-09-14T00:00:00.000Z";

function input(overrides = {}) {
  return {
    jobId: "call-job-1",
    requestId: "req_1720000000000_abc123",
    idempotencyKey: "call_fingerprint_001",
    workspaceContext,
    metadata: { sourceFile: "recording.m4a" },
    ...overrides,
  };
}

test("통화 Job은 Platform의 queued 상태와 Workspace 소유권으로 생성한다", () => {
  const job = createCallPlatformProcessingJob(input(), { now });

  assert.equal(job.status, "queued");
  assert.equal(job.stage, "");
  assert.equal(job.kind, "call");
  assert.equal(job.operation, "process");
  assert.equal(job.userId, "user-1");
  assert.equal(job.workspaceId, "workspace-1");
  assert.equal(job.metadata.sourceFile, "recording.m4a");
  assert.equal(job.metadata.callRequestId, "req_1720000000000_abc123");
  assert.equal(job.metadata.callFingerprint, "call_fingerprint_001");
  assert.match(job.idempotencyKey, /^idem:v1:call\.process:workspace:workspace-1:user:user-1:domain:call_fingerprint_001$/);
});

test("통화 세부 stage는 Platform status를 processing으로 유지한 채 표현한다", () => {
  const queued = createCallPlatformProcessingJob(input(), { now });
  const processing = transitionProcessingJob(queued, { status: "processing", stage: "transcribing" }, now);

  assert.equal(processing.status, "processing");
  assert.equal(processing.stage, "transcribing");
});

test("같은 통화 fingerprint의 다른 attempt는 같은 Job idempotency key를 사용한다", () => {
  const first = createCallPlatformProcessingJob(input(), { now });
  const second = createCallPlatformProcessingJob(input({
    jobId: "call-job-2",
    requestId: "req_1720000001000_def456",
  }), { now });

  assert.notEqual(first.requestId, second.requestId);
  assert.equal(first.idempotencyKey, second.idempotencyKey);
});

test("통화 fingerprint와 Job ID는 명시적으로 필요하다", () => {
  assert.throws(
    () => createCallPlatformProcessingJob(input({ idempotencyKey: "" }), { now }),
    (error) => error?.code === "CALL_IDEMPOTENCY_KEY_REQUIRED",
  );
  assert.throws(
    () => createCallPlatformProcessingJob(input({ jobId: "" }), { now }),
    (error) => error?.code === "PROCESSING_JOB_ID_REQUIRED",
  );
});
