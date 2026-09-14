import test from "node:test";
import assert from "node:assert/strict";

import { createCallPlatformProcessingJob } from "../netlify/shared/call-processing-job-adapter.mjs";
import {
  CALL_PLATFORM_STAGE_NAMES,
  createCallPlatformRetryPlan,
  runCallPlatformProcessing,
} from "../netlify/shared/call-retry-checkpoint-adapter.mjs";

const workspaceContext = { userId: "user-1", workspaceId: "workspace-1", role: "owner" };

function createJob() {
  return createCallPlatformProcessingJob({
    jobId: "call-job-120",
    requestId: "req_1720000000000_retry01",
    idempotencyKey: "call_fingerprint_retry_001",
    workspaceContext,
  }, { now: "2026-09-14T00:00:00.000Z" });
}

function runtime(startJob) {
  let current = startJob;
  let tick = 0;
  return {
    get current() { return current; },
    deps: {
      now() {
        tick += 1;
        return new Date(Date.parse("2026-09-14T00:00:00.000Z") + tick * 1000);
      },
      async saveJob(job) {
        current = job;
      },
    },
  };
}

function handlers(counters, fail = {}) {
  return {
    async uploading() {
      counters.uploading += 1;
      return { checkpoint: { objectPath: "private/call-job-120/audio.m4a" } };
    },
    async transcribing() {
      counters.transcribing += 1;
      if (fail.transcribing) throw Object.assign(new Error("stt temporary failure"), { code: "STT_TEMP" });
      return { checkpoint: "홍길동과 다음 주 미팅 일정 통화" };
    },
    async analyzing({ checkpoints }) {
      counters.analyzing += 1;
      assert.equal(typeof checkpoints.transcript, "string");
      if (fail.analyzing) throw Object.assign(new Error("ai temporary failure"), { code: "AI_TEMP" });
      return { checkpoint: { report: { headline: "다음 주 미팅 협의" }, actions: [] } };
    },
    async persisting({ checkpoints }) {
      counters.persisting += 1;
      assert.equal(checkpoints.analysis.report.headline, "다음 주 미팅 협의");
      if (fail.persisting) throw Object.assign(new Error("persist temporary failure"), { code: "PERSIST_TEMP" });
      return { checkpoint: { callId: "call-120" } };
    },
    async cleanup() {
      counters.cleanup += 1;
      return { checkpoint: true };
    },
  };
}

test("통화 stage는 Platform status가 아니라 processing.stage로 유지한다", () => {
  assert.deepEqual(
    CALL_PLATFORM_STAGE_NAMES,
    ["uploading", "transcribing", "analyzing", "persisting", "cleanup"],
  );
});

test("AI 실패 후 resume하면 transcript checkpoint 때문에 STT를 다시 실행하지 않는다", async () => {
  const counters = { uploading: 0, transcribing: 0, analyzing: 0, persisting: 0, cleanup: 0 };
  const firstRuntime = runtime(createJob());
  const first = await runCallPlatformProcessing({
    job: firstRuntime.current,
    handlers: handlers(counters, { analyzing: true }),
  }, firstRuntime.deps);

  assert.equal(first.ok, false);
  assert.equal(first.stage, "analyzing");
  assert.equal(first.job.status, "processing");
  assert.equal(first.job.stage, "analyzing");
  assert.equal(first.job.checkpoints.transcript, "홍길동과 다음 주 미팅 일정 통화");
  assert.equal(counters.transcribing, 1);

  const retryPlan = createCallPlatformRetryPlan(first.job, {
    retryableErrorCodes: ["AI_TEMP"],
    maxAttempts: 3,
    backoffMs: [0, 1000, 2000],
  }, "2026-09-14T00:01:00.000Z");
  assert.equal(retryPlan.status, "scheduled");
  assert.equal(retryPlan.stage, "analyzing");

  const secondRuntime = runtime(first.job);
  const second = await runCallPlatformProcessing({
    job: secondRuntime.current,
    handlers: handlers(counters),
  }, secondRuntime.deps);

  assert.equal(second.ok, true);
  assert.equal(counters.transcribing, 1);
  assert.equal(counters.analyzing, 2);
  assert.equal(counters.persisting, 1);
  assert.equal(counters.cleanup, 1);
});

test("persist 실패 후 resume하면 transcript와 analysis checkpoint 때문에 STT/AI를 다시 실행하지 않는다", async () => {
  const counters = { uploading: 0, transcribing: 0, analyzing: 0, persisting: 0, cleanup: 0 };
  const firstRuntime = runtime(createJob());
  const first = await runCallPlatformProcessing({
    job: firstRuntime.current,
    handlers: handlers(counters, { persisting: true }),
  }, firstRuntime.deps);

  assert.equal(first.ok, false);
  assert.equal(first.stage, "persisting");
  assert.equal(first.job.checkpoints.transcript, "홍길동과 다음 주 미팅 일정 통화");
  assert.equal(first.job.checkpoints.analysis.report.headline, "다음 주 미팅 협의");
  assert.equal(counters.transcribing, 1);
  assert.equal(counters.analyzing, 1);

  const secondRuntime = runtime(first.job);
  const second = await runCallPlatformProcessing({
    job: secondRuntime.current,
    handlers: handlers(counters),
  }, secondRuntime.deps);

  assert.equal(second.ok, true);
  assert.equal(counters.transcribing, 1);
  assert.equal(counters.analyzing, 1);
  assert.equal(counters.persisting, 2);
  assert.equal(counters.cleanup, 1);
});

test("통화 모듈이 retryableErrorCodes를 명시하지 않으면 재시도 계획을 만들지 않는다", async () => {
  const counters = { uploading: 0, transcribing: 0, analyzing: 0, persisting: 0, cleanup: 0 };
  const firstRuntime = runtime(createJob());
  const failed = await runCallPlatformProcessing({
    job: firstRuntime.current,
    handlers: handlers(counters, { transcribing: true }),
  }, firstRuntime.deps);

  assert.throws(
    () => createCallPlatformRetryPlan(failed.job, {}),
    (error) => error?.code === "CALL_RETRYABLE_ERROR_CODES_REQUIRED",
  );

  const notRetryable = createCallPlatformRetryPlan(failed.job, {
    retryableErrorCodes: ["OTHER_ERROR"],
    maxAttempts: 3,
    backoffMs: [0, 1000, 2000],
  }, "2026-09-14T00:01:00.000Z");
  assert.equal(notRetryable.status, "not_retryable");
});
