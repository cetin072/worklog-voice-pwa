import test from "node:test";
import assert from "node:assert/strict";

import { runProcessingStages } from "../netlify/shared/platform/processing-runner.mjs";

function clock(start = "2026-09-13T00:00:00Z") {
  let tick = 0;
  const base = new Date(start).getTime();
  return () => new Date(base + tick++ * 1000);
}

function baseJob(status = "queued", stage = "") {
  return {
    jobId: "job-1",
    requestId: "req-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    kind: "call",
    status,
    stage,
    createdAt: "2026-09-13T00:00:00Z",
  };
}

function setup(overrides = {}) {
  const saved = [];
  const usage = [];
  const calls = { stt: 0, ai: 0, persist: 0 };
  const deps = {
    now: clock(),
    saveJob: async (job) => saved.push(structuredClone(job)),
    recordUsage: async (event) => usage.push(event),
    ...overrides,
  };
  return { saved, usage, calls, deps };
}

function stageDefs(calls, controls = {}) {
  return [
    {
      name: "transcribing",
      run: async () => {
        calls.stt += 1;
        return {
          checkpoint: "hello",
          usage: { feature: "call_transcription", service: "stt" },
        };
      },
    },
    {
      name: "analyzing",
      run: async () => {
        calls.ai += 1;
        if (controls.failAiOnce) {
          controls.failAiOnce = false;
          throw new Error("AI fail");
        }
        return {
          checkpoint: { summary: "ok" },
          usage: { feature: "call_summary", service: "ai" },
        };
      },
    },
    {
      name: "persisting",
      run: async () => {
        calls.persist += 1;
        if (controls.failPersistOnce) {
          controls.failPersistOnce = false;
          throw new Error("DB fail");
        }
        return {
          checkpoint: { callId: "call-1" },
          usage: { feature: "call_persist", service: "database" },
        };
      },
    },
  ];
}

test("정상 다단계 실행은 각 stage를 1회 실행하고 completed로 끝난다", async () => {
  const state = setup();
  const result = await runProcessingStages({ job: baseJob(), stages: stageDefs(state.calls) }, state.deps);
  assert.equal(result.ok, true);
  assert.equal(result.job.status, "completed");
  assert.deepEqual(state.calls, { stt: 1, ai: 1, persist: 1 });
  assert.equal(state.usage.length, 3);
  assert.equal(result.job.checkpoints.transcribing, "hello");
});

test("AI 실패 후 resume은 성공한 STT를 재실행하지 않는다", async () => {
  const controls = { failAiOnce: true };
  const state = setup();
  const stages = stageDefs(state.calls, controls);
  const failed = await runProcessingStages({ job: baseJob(), stages }, state.deps);
  assert.equal(failed.ok, false);
  assert.equal(failed.stage, "analyzing");
  assert.equal(failed.job.checkpoints.transcribing, "hello");

  const resumed = await runProcessingStages({ job: failed.job, stages }, state.deps);
  assert.equal(resumed.ok, true);
  assert.deepEqual(state.calls, { stt: 1, ai: 2, persist: 1 });
  assert.equal(resumed.job.attemptCount, 2);
});

test("persist 실패 후 resume은 STT와 AI를 모두 재실행하지 않는다", async () => {
  const controls = { failPersistOnce: true };
  const state = setup();
  const stages = stageDefs(state.calls, controls);
  const failed = await runProcessingStages({ job: baseJob(), stages }, state.deps);
  assert.equal(failed.ok, false);
  assert.equal(failed.stage, "persisting");

  const resumed = await runProcessingStages({ job: failed.job, stages }, state.deps);
  assert.equal(resumed.ok, true);
  assert.deepEqual(state.calls, { stt: 1, ai: 1, persist: 2 });
});

test("Usage 기록 실패는 warning으로 격리하고 이미 성공한 stage를 되돌리지 않는다", async () => {
  const state = setup({
    recordUsage: async () => {
      throw new Error("usage fail");
    },
  });
  const result = await runProcessingStages({ job: baseJob(), stages: stageDefs(state.calls) }, state.deps);
  assert.equal(result.ok, true);
  assert.equal(result.usageWarnings.length, 3);
  assert.deepEqual(state.calls, { stt: 1, ai: 1, persist: 1 });
});

test("Usage recorder에는 Job/Workspace 문맥을 보강한다", async () => {
  const state = setup();
  await runProcessingStages({ job: baseJob(), stages: stageDefs(state.calls) }, state.deps);
  assert.equal(state.usage[0].jobId, "job-1");
  assert.equal(state.usage[0].requestId, "req-1");
  assert.equal(state.usage[0].userId, "user-1");
  assert.equal(state.usage[0].workspaceId, "workspace-1");
  assert.equal(state.usage[0].relatedType, "call");
});

test("중복 stage 이름은 실행 전에 차단한다", async () => {
  const state = setup();
  await assert.rejects(
    () => runProcessingStages({
      job: baseJob(),
      stages: [
        { name: "x", run: async () => 1 },
        { name: "x", run: async () => 2 },
      ],
    }, state.deps),
    (error) => error?.code === "PROCESSING_RUNNER_STAGE_DUPLICATE",
  );
  assert.equal(state.saved.length, 0);
});

test("잘못된 checkpoint key는 provider 실행 전에 차단한다", async () => {
  const state = setup();
  let called = 0;
  await assert.rejects(
    () => runProcessingStages({
      job: baseJob(),
      stages: [{ name: "x", checkpointKey: "bad key", run: async () => { called += 1; } }],
    }, state.deps),
    (error) => error?.code === "PROCESSING_RUNNER_CHECKPOINT_KEY_INVALID",
  );
  assert.equal(called, 0);
});

test("terminal Job은 실행하지 않는다", async () => {
  const state = setup();
  await assert.rejects(
    () => runProcessingStages({
      job: { ...baseJob("completed"), finishedAt: "2026-09-13T00:01:00Z" },
      stages: stageDefs(state.calls),
    }, state.deps),
    (error) => error?.code === "PROCESSING_RUNNER_JOB_NOT_RUNNABLE",
  );
});

test("resume stage가 정의에 없으면 실행 전에 차단한다", async () => {
  const state = setup();
  await assert.rejects(
    () => runProcessingStages({
      job: baseJob("processing", "unknown"),
      stages: stageDefs(state.calls),
    }, state.deps),
    (error) => error?.code === "PROCESSING_RUNNER_RESUME_STAGE_UNKNOWN",
  );
});
