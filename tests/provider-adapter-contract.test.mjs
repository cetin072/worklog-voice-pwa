import test from "node:test";
import assert from "node:assert/strict";
import {
  createUnconfiguredProviderAdapter,
  defaultProviderRegistry,
  normalizeAiAdapterResult,
  normalizeSttAdapterResult,
} from "../netlify/shared/provider-adapter-contract.mjs";

const RECORDED_AT = new Date("2026-09-13T10:00:00+09:00");

test("STT 응답을 내부 표준 형식으로 정규화한다", () => {
  const result = normalizeSttAdapterResult({
    text: "안녕하세요. 내일 오후 3시에 만나요.",
    language: "ko",
    requestId: "req-stt-1",
    provider: "openai",
    model: "example",
    segments: [
      { speakerLabel: "A", start: 0, end: 2.1, text: "안녕하세요." },
      { speakerLabel: "B", start: 2.2, end: 5.0, text: "내일 오후 3시에 만나요." },
    ],
    usage: { audioSeconds: 5, estimatedCostKrw: 10 },
  });
  assert.equal(result.transcript, "안녕하세요. 내일 오후 3시에 만나요.");
  assert.equal(result.segments.length, 2);
  assert.equal(result.segments[0].speaker, "A");
  assert.equal(result.providerRequestId, "req-stt-1");
  assert.equal(result.usage.service, "stt");
  assert.equal(result.usage.audioSeconds, 5);
});

test("빈 STT 전문은 차단한다", () => {
  assert.throws(() => normalizeSttAdapterResult({ text: "   " }), /STT_EMPTY_TRANSCRIPT/);
});

test("끝 시간이 시작보다 빠른 화자 segment는 버린다", () => {
  const result = normalizeSttAdapterResult({
    text: "전체 전문",
    segments: [
      { speaker: "A", startSeconds: 5, endSeconds: 2, text: "잘못된 구간" },
      { speaker: "B", startSeconds: 5, endSeconds: 8, text: "정상 구간" },
    ],
  });
  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].speaker, "B");
});

test("AI 응답은 기존 통화 분석 정규화 규칙을 거친다", () => {
  const result = normalizeAiAdapterResult({
    provider: "openai",
    model: "example-ai",
    providerRequestId: "req-ai-1",
    analysis: {
      summary: "미팅 일정을 논의했다.",
      actions: [
        { type: "schedule", content: "고객 미팅", dueText: "내일 오후 3시", confirmed: true },
      ],
    },
    usage: { inputTokens: 100, outputTokens: 30, estimatedCostKrw: 5 },
  }, { recordedAt: RECORDED_AT });
  assert.equal(result.analysis.actions[0].dueStart, "2026-09-14T15:00:00+09:00");
  assert.equal(result.analysis.actions[0].confirmed, false);
  assert.equal(result.usage.service, "ai");
  assert.equal(result.providerRequestId, "req-ai-1");
});

test("내용이 전혀 없는 AI 분석은 차단한다", () => {
  assert.throws(() => normalizeAiAdapterResult({ analysis: {} }, { recordedAt: RECORDED_AT }), /AI_EMPTY_ANALYSIS/);
});

test("미연결 공급자 어댑터는 네트워크 호출 대신 즉시 오류를 낸다", async () => {
  const adapter = createUnconfiguredProviderAdapter({ provider: "clova", service: "stt" });
  assert.equal(adapter.configured, false);
  await assert.rejects(adapter.run(), (error) => error.code === "PROVIDER_NOT_CONFIGURED");
});

test("기본 공급자 레지스트리는 모두 미연결 상태다", () => {
  const registry = defaultProviderRegistry();
  assert.equal(registry.stt.openai.configured, false);
  assert.equal(registry.stt.clova.configured, false);
  assert.equal(registry.stt.assemblyai.configured, false);
  assert.equal(registry.ai.openai.configured, false);
});
