import test from "node:test";
import assert from "node:assert/strict";

import {
  createConfiguredAdapter,
  createUnconfiguredAdapter,
} from "../netlify/shared/platform/adapter-boundary.mjs";
import { runCallAnalysis } from "../netlify/shared/call-analysis-adapter.mjs";

function transcript(overrides = {}) {
  return {
    text: "제안서는 9월 25일까지 제출하고 다음 주 화요일 오후 3시에 다시 통화하기로 했습니다.",
    language: "ko",
    provider: "mock-stt",
    model: "mock-stt-v1",
    providerRequestId: "stt-req-1",
    durationMs: 12000,
    sourceAudioRef: {
      sourceId: "upload-1",
      objectPath: "tmp/calls/workspace-1/upload-1.m4a",
    },
    segments: [{
      text: "제안서는 9월 25일까지 제출하고 다음 주 화요일 오후 3시에 다시 통화하기로 했습니다.",
      startMs: 1000,
      endMs: 9000,
      speakerId: "speaker-b",
      confidence: 0.95,
    }],
    ...overrides,
  };
}

function configuredAi({ service = "ai", operation = "analyze", run } = {}) {
  return createConfiguredAdapter({
    service,
    provider: "mock-ai",
    operation,
    async run(input, context) {
      if (run) return run(input, context);
      return {
        analysis: {
          title: "제안서 제출 및 후속 통화",
          summary: "제안서 제출기한과 후속 통화 일정을 합의함",
          keyPoints: ["9월 25일까지 제안서 제출"],
          report: {
            headline: "제안서 제출 일정 확정",
            overview: "제안서 제출과 후속 통화 일정을 논의했다.",
            discussionPoints: ["제안서 제출"],
            counterpartRequests: ["9월 25일까지 제출 요청"],
            userCommitments: ["기한 내 제출"],
            decisions: ["후속 통화 진행"],
            openQuestions: [],
          },
          actions: [{
            type: "schedule",
            content: "다시 통화",
            dueText: "다음 주 화요일 오후 3시",
            confidence: 0.9,
            confirmed: true,
            sourceExcerpt: "다음 주 화요일 오후 3시에 다시 통화",
          }],
          contacts: [],
          providerSpecificSecretShape: "ignore-me",
        },
        providerRequestId: "ai-req-1",
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    },
    async normalize(raw) {
      return {
        model: "mock-ai-v1",
        providerRequestId: raw.providerRequestId,
        result: raw,
        usage: raw.usage,
        metadata: { normalized: true },
      };
    },
  });
}

test("common Transcript becomes privacy-minimized AI input and normalized Call Analysis V2", async () => {
  let providerInput = null;
  const result = await runCallAnalysis({
    transcript: transcript(),
    contactName: "김대표",
    occurredAt: "2026-09-15T09:00:00+09:00",
  }, {
    aiAdapter: configuredAi({
      run(input) {
        providerInput = input;
        return {
          analysis: {
            title: "제안서 제출 및 후속 통화",
            summary: "제안서 제출기한과 후속 통화 일정을 합의함",
            keyPoints: ["9월 25일까지 제안서 제출"],
            report: {
              headline: "제안서 제출 일정 확정",
              overview: "제안서 제출과 후속 통화 일정을 논의했다.",
              discussionPoints: ["제안서 제출"],
              counterpartRequests: ["9월 25일까지 제출 요청"],
              userCommitments: ["기한 내 제출"],
              decisions: ["후속 통화 진행"],
              openQuestions: [],
            },
            actions: [{
              type: "schedule",
              content: "다시 통화",
              dueText: "다음 주 화요일 오후 3시",
              confidence: 0.9,
              confirmed: true,
              sourceExcerpt: "다음 주 화요일 오후 3시에 다시 통화",
            }],
            contacts: [],
            providerSpecificSecretShape: "ignore-me",
          },
          providerRequestId: "ai-req-1",
          usage: { inputTokens: 100, outputTokens: 50 },
        };
      },
    }),
  }, {
    requestId: "req-1",
    jobId: "job-1",
    userId: "user-1",
    workspaceId: "workspace-1",
  });

  assert.equal(providerInput.transcript.text, transcript().text);
  assert.equal(providerInput.transcript.segments[0].startMs, 1000);
  assert.equal(providerInput.transcript.segments[0].speakerId, "speaker-b");
  assert.equal("sourceAudioRef" in providerInput.transcript, false);
  assert.equal(JSON.stringify(providerInput).includes("tmp/calls/"), false);
  assert.match(providerInput.instruction, /김대표/);

  assert.equal(result.analysis.analysisVersion, "v2");
  assert.equal(result.analysis.actions[0].confirmed, false);
  assert.equal(result.analysis.actions[0].needsReview, false);
  assert.equal(result.analysis.actions[0].sourceExcerpt, "다음 주 화요일 오후 3시에 다시 통화");
  assert.equal("providerSpecificSecretShape" in result.analysis, false);
  assert.deepEqual(result.usage, { inputTokens: 100, outputTokens: 50 });
  assert.equal(result.adapter.provider, "mock-ai");
});

test("invalid schedule remains unconfirmed and needs review", async () => {
  const result = await runCallAnalysis({
    transcript: transcript({ text: "날짜가 모호한 후속 통화를 논의했습니다." }),
    occurredAt: "2026-09-15T09:00:00+09:00",
  }, {
    aiAdapter: configuredAi({
      run() {
        return {
          analysis: {
            summary: "후속 통화 논의",
            keyPoints: [],
            report: {},
            actions: [{
              type: "schedule",
              content: "언젠가 다시 통화",
              dueStart: "2026-99-99",
              dueHasTime: false,
              confidence: 0.4,
              confirmed: true,
            }],
            contacts: [],
          },
        };
      },
    }),
  });

  assert.equal(result.analysis.actions[0].confirmed, false);
  assert.equal(result.analysis.actions[0].dueStart, "");
  assert.equal(result.analysis.actions[0].needsReview, true);
});

test("wrong service and operation are rejected before AI execution", async () => {
  let called = false;
  const wrongService = createConfiguredAdapter({
    service: "stt",
    provider: "mock",
    operation: "analyze",
    async run() { called = true; return {}; },
    async normalize() { return { result: {} }; },
  });
  await assert.rejects(() => runCallAnalysis({ transcript: transcript() }, {
    aiAdapter: wrongService,
  }), (error) => error?.code === "CALL_AI_ADAPTER_SERVICE_REQUIRED");
  assert.equal(called, false);

  const wrongOperation = createConfiguredAdapter({
    service: "ai",
    provider: "mock",
    operation: "summarize",
    async run() { called = true; return {}; },
    async normalize() { return { result: {} }; },
  });
  await assert.rejects(() => runCallAnalysis({ transcript: transcript() }, {
    aiAdapter: wrongOperation,
  }), (error) => error?.code === "CALL_AI_ADAPTER_OPERATION_REQUIRED");
  assert.equal(called, false);
});

test("empty Transcript is rejected before provider execution", async () => {
  let called = false;
  const aiAdapter = configuredAi({
    run() {
      called = true;
      return {};
    },
  });

  await assert.rejects(() => runCallAnalysis({
    transcript: { text: "" },
  }, { aiAdapter }), (error) => error?.code === "TRANSCRIPT_TEXT_REQUIRED");
  assert.equal(called, false);
});

test("unconfigured AI adapter remains fail-closed", async () => {
  const aiAdapter = createUnconfiguredAdapter({
    service: "ai",
    provider: "future-ai",
    operation: "analyze",
  });
  await assert.rejects(() => runCallAnalysis({ transcript: transcript() }, {
    aiAdapter,
  }), (error) => error?.code === "ADAPTER_NOT_CONFIGURED");
});
