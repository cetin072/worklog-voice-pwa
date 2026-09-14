import test from "node:test";
import assert from "node:assert/strict";

import { normalizeTranscript } from "../netlify/shared/platform/transcript-contract.mjs";
import { normalizeCallSttResult } from "../netlify/shared/call-transcript-adapter.mjs";

const sourceAudioRef = Object.freeze({ localRef: "device://calls/2026-09-15-001.m4a" });

test("common transcript keeps text and extensible evidence segments", () => {
  const transcript = normalizeTranscript({
    text: "9월 25일까지 제안서를 제출하겠습니다.",
    language: "ko",
    segments: [{
      text: "9월 25일까지 제안서를 제출하겠습니다.",
      startMs: 32180,
      endMs: 37270,
      speakerId: "speaker-b",
      confidence: 0.94,
      sourceAudioRef,
    }],
  }, { sourceAudioRef });

  assert.equal(transcript.schemaVersion, "v1");
  assert.equal(transcript.text, "9월 25일까지 제안서를 제출하겠습니다.");
  assert.equal(transcript.segments[0].startMs, 32180);
  assert.equal(transcript.segments[0].endMs, 37270);
  assert.equal(transcript.segments[0].speakerId, "speaker-b");
  assert.equal(transcript.segments[0].confidence, 0.94);
  assert.equal(transcript.segments[0].sourceAudioRef.localRef, sourceAudioRef.localRef);
  assert.equal(transcript.sourceAudioRef.localRef, sourceAudioRef.localRef);
});

test("legacy STT seconds/speaker shape is promoted without Call-only fields", () => {
  const transcript = normalizeTranscript({
    transcript: "안녕하세요. 일정 확인 부탁드립니다.",
    segments: [{
      text: "안녕하세요.",
      startSeconds: 1.25,
      endSeconds: 2.5,
      speaker: "A",
    }],
  });

  assert.equal(transcript.segments[0].startMs, 1250);
  assert.equal(transcript.segments[0].endMs, 2500);
  assert.equal(transcript.segments[0].speakerId, "A");
  assert.equal("callId" in transcript, false);
});

test("timestamps, speaker, confidence and source references are optional", () => {
  const transcript = normalizeTranscript({
    text: "타임스탬프가 없는 공급자 결과도 허용합니다.",
    segments: [{ text: "타임스탬프가 없는 공급자 결과도 허용합니다." }],
  });

  assert.equal(transcript.segments[0].startMs, null);
  assert.equal(transcript.segments[0].endMs, null);
  assert.equal(transcript.segments[0].speakerId, null);
  assert.equal(transcript.segments[0].confidence, null);
  assert.equal(transcript.segments[0].sourceAudioRef, null);
});

test("invalid evidence ranges fail closed", () => {
  assert.throws(() => normalizeTranscript({
    text: "범위 오류",
    segments: [{ text: "범위 오류", startMs: 2000, endMs: 1000 }],
  }), (error) => error?.code === "TRANSCRIPT_SEGMENT_RANGE_INVALID");

  assert.throws(() => normalizeTranscript({
    text: "confidence 오류",
    segments: [{ text: "confidence 오류", confidence: 1.1 }],
  }), (error) => error?.code === "TRANSCRIPT_SEGMENT_CONFIDENCE_INVALID");
});

test("Call STT adapter promotes provider result through Platform Adapter Boundary", () => {
  const normalized = normalizeCallSttResult({
    service: "stt",
    provider: "openai",
    operation: "transcribe",
    model: "mock-stt-model",
    providerRequestId: "req-stt-001",
    result: {
      transcript: "회의는 다음 주 화요일입니다.",
      language: "ko",
      segments: [{
        text: "회의는 다음 주 화요일입니다.",
        startSeconds: 4,
        endSeconds: 7.5,
        speakerLabel: "speaker-1",
      }],
    },
    usage: { audioSeconds: 8, apiCalls: 1 },
  }, {
    sourceAudioRef,
    createdAt: "2026-09-15T00:00:00+09:00",
  });

  assert.equal(normalized.adapter.service, "stt");
  assert.equal(normalized.adapter.provider, "openai");
  assert.equal(normalized.adapter.operation, "transcribe");
  assert.equal(normalized.transcript.provider, "openai");
  assert.equal(normalized.transcript.model, "mock-stt-model");
  assert.equal(normalized.transcript.providerRequestId, "req-stt-001");
  assert.equal(normalized.transcript.segments[0].startMs, 4000);
  assert.equal(normalized.transcript.segments[0].speakerId, "speaker-1");
  assert.equal(normalized.transcript.sourceAudioRef.localRef, sourceAudioRef.localRef);
  assert.deepEqual(normalized.usage, { audioSeconds: 8, apiCalls: 1 });
});

test("Call STT adapter rejects non-STT services and missing providers", () => {
  assert.throws(() => normalizeCallSttResult({
    service: "ai",
    provider: "openai",
    result: { text: "not stt" },
  }), (error) => error?.code === "CALL_TRANSCRIPT_STT_SERVICE_REQUIRED");

  assert.throws(() => normalizeCallSttResult({
    service: "stt",
    result: { text: "provider missing" },
  }), (error) => error?.code === "CALL_TRANSCRIPT_PROVIDER_REQUIRED");
});

test("Call STT adapter leaves analysis outside the transcript contract", () => {
  const normalized = normalizeCallSttResult({
    service: "stt",
    provider: "mock",
    result: {
      text: "전사 원문",
      segments: [],
      analysis: { summary: "이 값은 transcript 핵심 계약이 아닙니다." },
    },
  });

  assert.equal(normalized.transcript.text, "전사 원문");
  assert.equal("analysis" in normalized.transcript, false);
});
