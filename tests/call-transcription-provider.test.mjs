import test from "node:test";
import assert from "node:assert/strict";

import {
  createConfiguredAdapter,
  createUnconfiguredAdapter,
} from "../netlify/shared/platform/adapter-boundary.mjs";
import { runCallTranscription } from "../netlify/shared/call-transcription-provider.mjs";

function callJob() {
  return {
    jobId: "job-call-175",
    requestId: "req-call-175",
    userId: "user-001",
    workspaceId: "workspace-001",
    kind: "call",
    operation: "process",
    status: "queued",
    createdAt: "2026-09-15T00:00:00.000Z",
    updatedAt: "2026-09-15T00:00:00.000Z",
  };
}

function verifiedAudio(overrides = {}) {
  return {
    uploadId: "upload-175",
    objectPath: "tmp/calls/workspace-001/upload-175.m4a",
    uploadedAt: "2026-09-15T00:00:00.000Z",
    expiresAt: "2026-09-15T06:00:00.000Z",
    sizeBytes: 4096,
    mimeType: "audio/mp4",
    fileName: "call-175.m4a",
    metadata: { verified: true },
    ...overrides,
  };
}

function storageAdapter(verified = verifiedAudio()) {
  return {
    configured: true,
    async verifyPreparedUpload() {
      return verified;
    },
  };
}

function configuredStt({ run, provider = "mock-stt", operation = "transcribe" } = {}) {
  return createConfiguredAdapter({
    service: "stt",
    provider,
    operation,
    async run(input, context) {
      if (run) return run(input, context);
      return {
        transcript: "9월 25일까지 제안서를 제출하겠습니다.",
        segments: [{
          text: "9월 25일까지 제안서를 제출하겠습니다.",
          startSeconds: 1.25,
          endSeconds: 3.5,
          speaker: "B",
          confidence: 0.93,
          sourceAudioRef: { objectPath: "provider/spoofed/path.wav" },
        }],
        providerRequestId: "provider-req-175",
        usage: { audioSeconds: 4 },
      };
    },
    async normalize(raw) {
      return {
        model: "mock-model-v1",
        providerRequestId: raw.providerRequestId,
        result: raw,
        usage: raw.usage,
        metadata: { normalized: true },
      };
    },
  });
}

test("verified prepared audio is the only provider source and becomes Transcript evidence", async () => {
  let providerInput = null;
  let providerContext = null;
  const result = await runCallTranscription({
    job: callJob(),
    preparedUpload: {
      uploadId: "upload-175",
      objectPath: "client/spoofed/path.m4a",
    },
    language: "ko",
    durationSeconds: 4,
  }, {
    storageAdapter: storageAdapter(),
    sttAdapter: configuredStt({
      run(input, context) {
        providerInput = input;
        providerContext = context;
        return {
          transcript: "9월 25일까지 제안서를 제출하겠습니다.",
          segments: [{
            text: "9월 25일까지 제안서를 제출하겠습니다.",
            startSeconds: 1.25,
            endSeconds: 3.5,
            speaker: "B",
            confidence: 0.93,
            sourceAudioRef: { objectPath: "provider/spoofed/path.wav" },
          }],
          providerRequestId: "provider-req-175",
          usage: { audioSeconds: 4 },
        };
      },
    }),
  }, {
    now: "2026-09-15T00:10:00.000Z",
  });

  assert.equal(providerInput.audio.objectPath, "tmp/calls/workspace-001/upload-175.m4a");
  assert.notEqual(providerInput.audio.objectPath, "client/spoofed/path.m4a");
  assert.equal(providerContext.workspaceId, "workspace-001");
  assert.equal(result.transcript.text, "9월 25일까지 제안서를 제출하겠습니다.");
  assert.equal(result.transcript.segments[0].startMs, 1250);
  assert.equal(result.transcript.segments[0].endMs, 3500);
  assert.equal(result.transcript.segments[0].speakerId, "B");
  assert.equal(result.transcript.segments[0].confidence, 0.93);
  assert.equal(result.transcript.sourceAudioRef.objectPath, "tmp/calls/workspace-001/upload-175.m4a");
  assert.equal(result.transcript.segments[0].sourceAudioRef.objectPath, "tmp/calls/workspace-001/upload-175.m4a");
  assert.deepEqual(result.usage, { audioSeconds: 4 });
  assert.equal(result.adapter.provider, "mock-stt");
});

test("expired verified audio prevents STT provider execution", async () => {
  let called = false;
  const sttAdapter = configuredStt({
    run() {
      called = true;
      return { transcript: "호출되면 안 됨" };
    },
  });

  await assert.rejects(() => runCallTranscription({
    job: callJob(),
    preparedUpload: { uploadId: "upload-175" },
  }, {
    storageAdapter: storageAdapter(verifiedAudio({ expiresAt: "2026-09-15T00:05:00.000Z" })),
    sttAdapter,
  }, {
    now: "2026-09-15T00:10:00.000Z",
  }), (error) => error?.code === "CALL_PREPARED_AUDIO_EXPIRED");

  assert.equal(called, false);
});

test("wrong adapter service and operation are rejected before provider execution", async () => {
  let aiCalled = false;
  const aiAdapter = createConfiguredAdapter({
    service: "ai",
    provider: "mock-ai",
    operation: "analyze",
    async run() {
      aiCalled = true;
      return {};
    },
    async normalize() {
      return { result: {} };
    },
  });

  await assert.rejects(() => runCallTranscription({
    job: callJob(),
    preparedUpload: { uploadId: "upload-175" },
  }, {
    storageAdapter: storageAdapter(),
    sttAdapter: aiAdapter,
  }), (error) => error?.code === "CALL_STT_ADAPTER_SERVICE_REQUIRED");
  assert.equal(aiCalled, false);

  let wrongOperationCalled = false;
  const wrongOperation = createConfiguredAdapter({
    service: "stt",
    provider: "mock-stt",
    operation: "summarize",
    async run() {
      wrongOperationCalled = true;
      return {};
    },
    async normalize() {
      return { result: {} };
    },
  });

  await assert.rejects(() => runCallTranscription({
    job: callJob(),
    preparedUpload: { uploadId: "upload-175" },
  }, {
    storageAdapter: storageAdapter(),
    sttAdapter: wrongOperation,
  }), (error) => error?.code === "CALL_STT_ADAPTER_OPERATION_REQUIRED");
  assert.equal(wrongOperationCalled, false);
});

test("unconfigured Platform STT adapter remains fail-closed", async () => {
  const unconfigured = createUnconfiguredAdapter({
    service: "stt",
    provider: "future-provider",
    operation: "transcribe",
  });

  await assert.rejects(() => runCallTranscription({
    job: callJob(),
    preparedUpload: { uploadId: "upload-175" },
  }, {
    storageAdapter: storageAdapter(),
    sttAdapter: unconfigured,
  }, {
    now: "2026-09-15T00:10:00.000Z",
  }), (error) => error?.code === "ADAPTER_NOT_CONFIGURED");
});

test("server uploadId correlation mismatch blocks provider execution", async () => {
  let called = false;
  const sttAdapter = configuredStt({
    run() {
      called = true;
      return { transcript: "호출되면 안 됨" };
    },
  });

  await assert.rejects(() => runCallTranscription({
    job: callJob(),
    preparedUpload: { uploadId: "upload-175" },
  }, {
    storageAdapter: storageAdapter(verifiedAudio({ uploadId: "upload-other" })),
    sttAdapter,
  }, {
    now: "2026-09-15T00:10:00.000Z",
  }), (error) => error?.code === "CALL_STORAGE_VERIFICATION_MISMATCH");

  assert.equal(called, false);
});
