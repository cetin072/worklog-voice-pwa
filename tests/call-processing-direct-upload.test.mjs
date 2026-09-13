import test from "node:test";
import assert from "node:assert/strict";
import { runCallProcessingPipeline } from "../netlify/shared/call-processing-runner.mjs";

test("검증된 direct upload가 있으면 Netlify 서버 업로드 단계를 건너뛴다", async () => {
  let uploadTempCalled = false;
  let verifyCalled = false;
  let deletedPath = "";
  const usage = [];
  let tick = 0;
  const now = () => new Date(Date.parse("2026-09-13T09:05:00Z") + tick++ * 1000);

  const preparedUpload = {
    uploadId: "up-1",
    objectPath: "call-temp/user-1/up-1.m4a",
    uploadedAt: "2026-09-13T09:00:00Z",
    expiresAt: "2026-09-14T09:00:00Z",
    sizeBytes: 10_000_000,
    mimeType: "audio/mp4",
    fileName: "call.m4a",
  };

  const result = await runCallProcessingPipeline({
    job: {
      status: "queued",
      requestId: "req-direct-1",
      kind: "call",
      createdAt: "2026-09-13T09:05:00Z",
      sourceStartedAt: "2026-09-13T08:30:00Z",
      finishedAt: null,
    },
    preparedUpload,
    policy: { maxTempRetentionHours: 24, failedTempRetentionHours: 6, transcriptRetention: "keep" },
  }, {
    now,
    saveJob: async () => {},
    verifyPreparedUpload: async ({ preparedUpload: incoming }) => {
      verifyCalled = true;
      return {
        ...incoming,
        usage: { feature: "call_audio_temp", service: "storage", storageBytes: incoming.sizeBytes },
      };
    },
    uploadTemp: async () => {
      uploadTempCalled = true;
      throw new Error("직접 업로드 경로에서는 호출되면 안 됨");
    },
    transcribe: async ({ objectPath }) => {
      assert.equal(objectPath, preparedUpload.objectPath);
      return {
        transcript: "내일 오후 3시에 고객과 통화하기로 했다.",
        providerRequestId: "stt-1",
        usage: { feature: "call_transcription", service: "stt", audioSeconds: 60 },
      };
    },
    analyze: async () => ({
      providerRequestId: "ai-1",
      analysis: {
        title: "고객 통화",
        summary: "후속 통화 일정을 정했다.",
        keyPoints: ["내일 오후 3시 통화"],
        actions: [{ type: "schedule", content: "고객 통화", dueText: "내일 오후 3시" }],
        contacts: [],
      },
      usage: { feature: "call_summary", service: "ai", inputTokens: 20, outputTokens: 10 },
    }),
    persistResult: async () => ({
      callId: "call-direct-1",
      usage: { feature: "call_persist", service: "database", apiCalls: 1 },
    }),
    deleteTemp: async ({ objectPath }) => { deletedPath = objectPath; },
    recordUsage: async (event) => { usage.push(event); },
  });

  assert.equal(result.ok, true);
  assert.equal(verifyCalled, true);
  assert.equal(uploadTempCalled, false);
  assert.equal(deletedPath, preparedUpload.objectPath);
  assert.equal(usage.some((event) => event.service === "storage"), true);
  assert.equal(usage.some((event) => event.service === "stt"), true);
  assert.equal(result.callId, "call-direct-1");
});

test("검증되지 않은 prepared upload는 verifyPreparedUpload 없이 처리하지 않는다", async () => {
  const result = await runCallProcessingPipeline({
    job: {
      status: "queued",
      requestId: "req-direct-2",
      kind: "call",
      createdAt: "2026-09-13T09:05:00Z",
      finishedAt: null,
    },
    preparedUpload: {
      uploadId: "up-2",
      objectPath: "call-temp/up-2.m4a",
      uploadedAt: "2026-09-13T09:00:00Z",
      expiresAt: "2026-09-14T09:00:00Z",
      sizeBytes: 1,
    },
    policy: { maxTempRetentionHours: 24 },
  }, {
    transcribe: async () => ({}),
    analyze: async () => ({}),
    persistResult: async () => ({}),
    deleteTemp: async () => {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.stage, "uploading");
  assert.match(result.error.message, /verifyPreparedUpload/);
});
