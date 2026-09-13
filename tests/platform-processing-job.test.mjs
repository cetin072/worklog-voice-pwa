import test from "node:test";
import assert from "node:assert/strict";
import {
  PROCESSING_JOB_STATUSES,
  canTransitionProcessingJobStatus,
  clearProcessingCheckpoint,
  createUnconfiguredProcessingJobStoreAdapter,
  incrementProcessingAttempt,
  normalizeProcessingJob,
  setProcessingCheckpoint,
  transitionProcessingJob,
} from "../netlify/shared/platform/processing-job.mjs";

const workspaceContext = { userId: "user-1", workspaceId: "workspace-1", role: "owner" };
const base = {
  jobId: "job-1",
  requestId: "req-1",
  kind: "call",
  status: "queued",
  createdAt: "2026-09-13T00:00:00.000Z",
};

test("Platform common status는 5개만 공개하고 통화 stage를 status로 승격하지 않는다", () => {
  assert.deepEqual([...PROCESSING_JOB_STATUSES], ["queued", "processing", "completed", "failed", "cancelled"]);
  for (const legacy of ["uploading", "transcribing", "analyzing", "persisting", "cleanup_pending", "retry_wait"]) {
    assert.equal(PROCESSING_JOB_STATUSES.includes(legacy), false);
  }
});

test("queued Job은 Workspace Context 소유권을 소비하고 role은 저장하지 않는다", () => {
  const job = normalizeProcessingJob(base, { workspaceContext });
  assert.equal(job.userId, "user-1");
  assert.equal(job.workspaceId, "workspace-1");
  assert.equal("role" in job, false);
  assert.equal(job.status, "queued");
  assert.equal(job.stage, "");
});

test("DB snake_case identity도 읽을 수 있다", () => {
  const job = normalizeProcessingJob({ ...base, user_id: "u-db", workspace_id: "w-db" });
  assert.equal(job.userId, "u-db");
  assert.equal(job.workspaceId, "w-db");
});

test("processing 상태에는 opaque stage가 필요하다", () => {
  assert.throws(
    () => normalizeProcessingJob({ ...base, status: "processing" }, { workspaceContext }),
    (error) => error?.code === "PROCESSING_JOB_STAGE_REQUIRED",
  );
  const job = normalizeProcessingJob({ ...base, status: "processing", stage: "transcribing" }, { workspaceContext });
  assert.equal(job.stage, "transcribing");
});

test("queued → processing → processing → completed 전이를 지원한다", () => {
  const queued = normalizeProcessingJob(base, { workspaceContext });
  const transcribing = transitionProcessingJob(queued, { status: "processing", stage: "transcribing" }, "2026-09-13T00:01:00Z");
  const analyzing = transitionProcessingJob(transcribing, { status: "processing", stage: "analyzing" }, "2026-09-13T00:02:00Z");
  const completed = transitionProcessingJob(analyzing, { status: "completed" }, "2026-09-13T00:03:00Z");
  assert.equal(transcribing.stage, "transcribing");
  assert.equal(analyzing.stage, "analyzing");
  assert.equal(completed.status, "completed");
  assert.equal(completed.finishedAt, "2026-09-13T00:03:00.000Z");
});

test("terminal 상태에서는 재진입할 수 없다", () => {
  const failed = normalizeProcessingJob({ ...base, status: "failed", userId: "u", workspaceId: "w", finishedAt: "2026-09-13T00:02:00Z" });
  assert.equal(canTransitionProcessingJobStatus("failed", "processing"), false);
  assert.throws(
    () => transitionProcessingJob(failed, { status: "processing", stage: "uploading" }),
    (error) => error?.code === "PROCESSING_JOB_TRANSITION_INVALID",
  );
});

test("checkpoint set/clear는 원본 Job을 변경하지 않는다", () => {
  const processing = normalizeProcessingJob({ ...base, status: "processing", stage: "transcribing" }, { workspaceContext });
  const saved = setProcessingCheckpoint(processing, "transcript", "내용", "2026-09-13T00:01:00Z");
  assert.equal(processing.checkpoints.transcript, undefined);
  assert.equal(saved.checkpoints.transcript, "내용");
  const cleared = clearProcessingCheckpoint(saved, "transcript", "2026-09-13T00:02:00Z");
  assert.equal(cleared.checkpoints.transcript, undefined);
});

test("terminal Job의 checkpoint/attempt 변경을 차단한다", () => {
  const completed = normalizeProcessingJob({
    ...base,
    status: "completed",
    userId: "u",
    workspaceId: "w",
    finishedAt: "2026-09-13T00:03:00Z",
  });
  assert.throws(() => setProcessingCheckpoint(completed, "late", true), (e) => e?.code === "PROCESSING_JOB_TERMINAL_IMMUTABLE");
  assert.throws(() => incrementProcessingAttempt(completed), (e) => e?.code === "PROCESSING_JOB_TERMINAL_IMMUTABLE");
});

test("attemptCount는 명시적 helper로만 증가시킨다", () => {
  const job = normalizeProcessingJob(base, { workspaceContext });
  const next = incrementProcessingAttempt(job, "2026-09-13T00:01:00Z");
  assert.equal(job.attemptCount, 0);
  assert.equal(next.attemptCount, 1);
});

test("잘못된 kind/stage를 차단한다", () => {
  assert.throws(() => normalizeProcessingJob({ ...base, kind: "bad kind" }, { workspaceContext }), (e) => e?.code === "PROCESSING_JOB_KIND_INVALID");
  assert.throws(() => normalizeProcessingJob({ ...base, status: "processing", stage: "bad stage" }, { workspaceContext }), (e) => e?.code === "PROCESSING_JOB_STAGE_INVALID");
});

test("식별자와 idempotencyKey 길이 초과를 조용히 자르지 않는다", () => {
  assert.throws(
    () => normalizeProcessingJob({ ...base, jobId: "j".repeat(201) }, { workspaceContext }),
    (e) => e?.code === "PROCESSING_JOB_ID_INVALID",
  );
  assert.throws(
    () => normalizeProcessingJob({ ...base, idempotencyKey: "k".repeat(501) }, { workspaceContext }),
    (e) => e?.code === "PROCESSING_JOB_IDEMPOTENCY_KEY_INVALID",
  );
});

test("잘못된 상태변경 시각을 조용히 현재시각으로 바꾸지 않는다", () => {
  const job = normalizeProcessingJob(base, { workspaceContext });
  assert.throws(
    () => transitionProcessingJob(job, { status: "processing", stage: "uploading" }, "bad"),
    (e) => e?.code === "PROCESSING_JOB_UPDATED_AT_INVALID",
  );
});

test("failed/cancelled도 terminal finishedAt을 기록한다", () => {
  const job = normalizeProcessingJob(base, { workspaceContext });
  const failed = transitionProcessingJob(job, { status: "failed", errorCode: "X", errorMessage: "실패" }, "2026-09-13T00:04:00Z");
  assert.equal(failed.finishedAt, "2026-09-13T00:04:00.000Z");
  assert.equal(failed.errorCode, "X");
});

test("미연결 Job store adapter는 명시적으로 잠긴다", async () => {
  const store = createUnconfiguredProcessingJobStoreAdapter();
  assert.equal(store.configured, false);
  await assert.rejects(() => store.get("job-1"), (e) => e?.code === "PROCESSING_JOB_STORE_NOT_CONFIGURED");
  await assert.rejects(() => store.save({}), (e) => e?.code === "PROCESSING_JOB_STORE_NOT_CONFIGURED");
});
