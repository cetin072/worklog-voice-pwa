import test from "node:test";
import assert from "node:assert/strict";
import {
  resumeCallProcessingPipeline,
  retryCallCleanup,
  runCallProcessingPipeline,
} from "../netlify/shared/call-processing-runner.mjs";

function clock(start = "2026-09-13T00:00:00Z") {
  let tick = 0;
  const base = new Date(start).getTime();
  return () => new Date(base + tick++ * 1000);
}

function baseJob() {
  return {
    status: "queued",
    requestId: "req-test-1",
    kind: "call",
    createdAt: "2026-09-13T00:00:00Z",
    sourceStartedAt: "2026-09-13T09:00:00+09:00",
    finishedAt: null,
  };
}

function successDeps(overrides = {}) {
  const saved = [];
  const usage = [];
  const calls = { upload: 0, stt: 0, ai: 0, persist: 0, delete: 0 };
  const deps = {
    now: clock(),
    saveJob: async (job) => saved.push(structuredClone(job)),
    uploadTemp: async () => {
      calls.upload += 1;
      return {
        objectPath: "tmp/recording.m4a",
        uploadedAt: "2026-09-13T00:00:02Z",
        usage: { feature: "call_processing", service: "storage", estimatedCostKrw: 1 },
      };
    },
    transcribe: async () => {
      calls.stt += 1;
      return {
        transcript: "내일 오후 3시 고객과 미팅하기로 했다.",
        providerRequestId: "stt-req-1",
        usage: { feature: "call_transcription", service: "stt", audioSeconds: 60, estimatedCostKrw: 10 },
      };
    },
    analyze: async () => {
      calls.ai += 1;
      return {
        providerRequestId: "ai-req-1",
        analysis: {
          title: "고객 미팅 약속",
          summary: "내일 오후 3시 미팅을 약속했다.",
          keyPoints: ["미팅 일정 확정"],
          actions: [{ type: "schedule", content: "고객 미팅", dueText: "내일 오후 3시", confirmed: true }],
          contacts: [],
        },
        usage: { feature: "call_summary", service: "ai", inputTokens: 100, outputTokens: 50, estimatedCostKrw: 2 },
      };
    },
    persistResult: async () => {
      calls.persist += 1;
      return {
        callId: "call-1",
        usage: { feature: "call_persist", service: "database", apiCalls: 1, estimatedCostKrw: 0.1 },
      };
    },
    deleteTemp: async () => { calls.delete += 1; },
    recordUsage: async (event) => usage.push(event),
    ...overrides,
  };
  return { deps, saved, usage, calls };
}

const policy = { failedTempRetentionHours: 6, maxTempRetentionHours: 24, transcriptRetention: "keep" };

test("정상 처리하면 STT와 AI를 각 1회 실행하고 임시음성을 삭제한다", async () => {
  const { deps, saved, usage, calls } = successDeps();
  const result = await runCallProcessingPipeline({ job: baseJob(), source: { fake: true }, policy }, deps);
  assert.equal(result.ok, true);
  assert.equal(result.cleanupPending, false);
  assert.equal(result.job.status, "completed");
  assert.equal(result.job.tempObjectPath, null);
  assert.equal(result.analysis.actions[0].confirmed, false);
  assert.deepEqual(calls, { upload: 1, stt: 1, ai: 1, persist: 1, delete: 1 });
  assert.equal(usage.length, 4);
  assert.ok(saved.some((job) => job.status === "cleanup_pending"));
});

test("AI가 실패하면 STT 녹취 체크포인트를 남긴다", async () => {
  const base = successDeps();
  base.deps.analyze = async () => { base.calls.ai += 1; throw new Error("AI 일시 오류"); };
  const result = await runCallProcessingPipeline({ job: baseJob(), source: {}, policy }, base.deps);
  assert.equal(result.ok, false);
  assert.equal(result.stage, "analyzing");
  assert.equal(result.job.retryStage, "analyzing");
  assert.equal(result.job.transcriptCheckpoint, "내일 오후 3시 고객과 미팅하기로 했다.");
  assert.equal(base.calls.stt, 1);
});

test("AI 실패 후 재시도는 STT를 건너뛴다", async () => {
  const base = successDeps();
  let first = true;
  base.deps.analyze = async () => {
    base.calls.ai += 1;
    if (first) { first = false; throw new Error("AI 일시 오류"); }
    return {
      providerRequestId: "ai-req-2",
      analysis: { summary: "재시도 성공", keyPoints: [], actions: [], contacts: [] },
      usage: { feature: "call_summary", service: "ai", estimatedCostKrw: 2 },
    };
  };
  const failed = await runCallProcessingPipeline({ job: baseJob(), source: {}, policy }, base.deps);
  const resumed = await resumeCallProcessingPipeline({ job: failed.job, policy }, base.deps);
  assert.equal(resumed.ok, true);
  assert.equal(resumed.job.status, "completed");
  assert.equal(base.calls.upload, 1);
  assert.equal(base.calls.stt, 1);
  assert.equal(base.calls.ai, 2);
  assert.equal(base.calls.persist, 1);
});

test("DB 저장이 실패하면 AI 분석 체크포인트를 남긴다", async () => {
  const base = successDeps();
  base.deps.persistResult = async () => { base.calls.persist += 1; throw new Error("DB 일시 오류"); };
  const result = await runCallProcessingPipeline({ job: baseJob(), source: {}, policy }, base.deps);
  assert.equal(result.ok, false);
  assert.equal(result.stage, "persisting");
  assert.equal(result.job.analysisCheckpoint.summary, "내일 오후 3시 미팅을 약속했다.");
  assert.equal(base.calls.stt, 1);
  assert.equal(base.calls.ai, 1);
});

test("DB 저장 실패 후 재시도는 STT와 AI를 모두 건너뛴다", async () => {
  const base = successDeps();
  let first = true;
  base.deps.persistResult = async () => {
    base.calls.persist += 1;
    if (first) { first = false; throw new Error("DB 일시 오류"); }
    return { callId: "call-retry", usage: { feature: "call_persist", service: "database" } };
  };
  const failed = await runCallProcessingPipeline({ job: baseJob(), source: {}, policy }, base.deps);
  const resumed = await resumeCallProcessingPipeline({ job: failed.job, policy }, base.deps);
  assert.equal(resumed.ok, true);
  assert.equal(resumed.callId, "call-retry");
  assert.equal(base.calls.stt, 1);
  assert.equal(base.calls.ai, 1);
  assert.equal(base.calls.persist, 2);
});

test("결과 저장 후 음성 삭제만 실패하면 cleanup_pending에 둔다", async () => {
  const base = successDeps();
  base.deps.deleteTemp = async () => { base.calls.delete += 1; throw new Error("임시파일 삭제 실패"); };
  const result = await runCallProcessingPipeline({ job: baseJob(), source: {}, policy }, base.deps);
  assert.equal(result.ok, true);
  assert.equal(result.cleanupPending, true);
  assert.equal(result.job.status, "cleanup_pending");
  assert.equal(result.job.errorCode, "TEMP_DELETE_FAILED");
  assert.equal(base.calls.stt, 1);
  assert.equal(base.calls.ai, 1);
});

test("cleanup_pending 재시도는 삭제만 실행한다", async () => {
  const base = successDeps();
  let first = true;
  base.deps.deleteTemp = async () => {
    base.calls.delete += 1;
    if (first) { first = false; throw new Error("첫 삭제 실패"); }
  };
  const pending = await runCallProcessingPipeline({ job: baseJob(), source: {}, policy }, base.deps);
  const cleaned = await retryCallCleanup({ job: pending.job, policy }, base.deps);
  assert.equal(cleaned.ok, true);
  assert.equal(cleaned.job.status, "completed");
  assert.equal(base.calls.stt, 1);
  assert.equal(base.calls.ai, 1);
  assert.equal(base.calls.persist, 1);
  assert.equal(base.calls.delete, 2);
});

test("사용량 기록이 실패해도 이미 비용이 발생한 STT와 AI를 다시 실행하지 않는다", async () => {
  const base = successDeps({ recordUsage: async () => { throw new Error("usage ledger 일시 오류"); } });
  const result = await runCallProcessingPipeline({ job: baseJob(), source: {}, policy }, base.deps);
  assert.equal(result.ok, true);
  assert.equal(result.job.status, "completed");
  assert.equal(result.usageWarnings.length, 4);
  assert.equal(base.calls.stt, 1);
  assert.equal(base.calls.ai, 1);
  assert.equal(base.calls.persist, 1);
});
