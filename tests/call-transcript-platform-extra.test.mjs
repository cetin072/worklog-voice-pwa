import test from "node:test";
import assert from "node:assert/strict";

import { normalizeTranscript } from "../netlify/shared/platform/transcript-contract.mjs";
import { normalizeCallSttResult } from "../netlify/shared/call-transcript-adapter.mjs";

test("transcript duration is optional and converts seconds to milliseconds", () => {
  assert.equal(normalizeTranscript({ text: "duration 없음" }).durationMs, null);
  assert.equal(normalizeTranscript({ text: "duration 있음", durationSeconds: 12.345 }).durationMs, 12345);
});

test("transcript source audio reference requires a stable locator", () => {
  assert.throws(() => normalizeTranscript({
    text: "source ref",
    sourceAudioRef: {},
  }), (error) => error?.code === "TRANSCRIPT_SOURCE_AUDIO_REF_EMPTY");

  const transcript = normalizeTranscript({
    text: "source ref",
    sourceAudioRef: { sourceId: "audio-001" },
  });
  assert.equal(transcript.sourceAudioRef.sourceId, "audio-001");
});

test("Call STT adapter does not expose provider-specific result fields as transcript fields", () => {
  const normalized = normalizeCallSttResult({
    service: "stt",
    provider: "mock",
    result: {
      text: "공통 원문",
      providerSpecificSecretShape: "ignore-me",
    },
  });

  assert.equal(normalized.transcript.text, "공통 원문");
  assert.equal("providerSpecificSecretShape" in normalized.transcript, false);
});
