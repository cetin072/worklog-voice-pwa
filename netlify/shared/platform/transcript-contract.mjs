export const TRANSCRIPT_SCHEMA_VERSION = "v1";

function transcriptError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function rawText(value) {
  return String(value ?? "").trim();
}

function boundedText(value, max, code, label) {
  const normalized = rawText(value);
  if (normalized.length > max) throw transcriptError(code, `${label}가 허용 길이를 초과했습니다.`);
  return normalized;
}

function optionalNumber(value, code, label, { min = 0, max = Number.POSITIVE_INFINITY } = {}) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw transcriptError(code, `${label} 값이 올바르지 않습니다.`);
  }
  return number;
}

function normalizeSourceAudioRef(value = {}) {
  if (value === null || value === undefined || value === "") return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw transcriptError("TRANSCRIPT_SOURCE_AUDIO_REF_INVALID", "sourceAudioRef는 객체여야 합니다.");
  }

  const sourceId = boundedText(
    value.sourceId ?? value.source_id ?? value.id,
    200,
    "TRANSCRIPT_SOURCE_AUDIO_ID_INVALID",
    "sourceAudioRef.sourceId",
  );
  const objectPath = boundedText(
    value.objectPath ?? value.object_path,
    500,
    "TRANSCRIPT_SOURCE_AUDIO_PATH_INVALID",
    "sourceAudioRef.objectPath",
  );
  const localRef = boundedText(
    value.localRef ?? value.local_ref,
    500,
    "TRANSCRIPT_SOURCE_AUDIO_LOCAL_REF_INVALID",
    "sourceAudioRef.localRef",
  );

  if (!sourceId && !objectPath && !localRef) {
    throw transcriptError(
      "TRANSCRIPT_SOURCE_AUDIO_REF_EMPTY",
      "sourceAudioRef에는 sourceId, objectPath 또는 localRef 중 하나가 필요합니다.",
    );
  }

  return Object.freeze({ sourceId, objectPath, localRef });
}

function normalizeSegment(value, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw transcriptError("TRANSCRIPT_SEGMENT_INVALID", `segments[${index}]가 객체가 아닙니다.`);
  }

  const text = boundedText(
    value.text ?? value.transcript,
    8000,
    "TRANSCRIPT_SEGMENT_TEXT_INVALID",
    `segments[${index}].text`,
  );
  if (!text) throw transcriptError("TRANSCRIPT_SEGMENT_TEXT_REQUIRED", `segments[${index}].text가 필요합니다.`);

  const startMs = optionalNumber(
    value.startMs ?? value.start_ms ?? (value.startSeconds ?? value.start) * 1000,
    "TRANSCRIPT_SEGMENT_START_INVALID",
    `segments[${index}].startMs`,
  );
  const endMs = optionalNumber(
    value.endMs ?? value.end_ms ?? (value.endSeconds ?? value.end) * 1000,
    "TRANSCRIPT_SEGMENT_END_INVALID",
    `segments[${index}].endMs`,
  );
  if (startMs !== null && endMs !== null && endMs < startMs) {
    throw transcriptError("TRANSCRIPT_SEGMENT_RANGE_INVALID", `segments[${index}]의 종료시각이 시작시각보다 빠릅니다.`);
  }

  const speakerId = boundedText(
    value.speakerId ?? value.speaker_id ?? value.speaker ?? value.speakerLabel,
    120,
    "TRANSCRIPT_SEGMENT_SPEAKER_INVALID",
    `segments[${index}].speakerId`,
  );
  const confidence = optionalNumber(
    value.confidence,
    "TRANSCRIPT_SEGMENT_CONFIDENCE_INVALID",
    `segments[${index}].confidence`,
    { min: 0, max: 1 },
  );

  return Object.freeze({
    index,
    text,
    startMs,
    endMs,
    speakerId: speakerId || null,
    confidence,
    sourceAudioRef: normalizeSourceAudioRef(value.sourceAudioRef ?? value.source_audio_ref),
  });
}

export function normalizeTranscript(raw = {}, context = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const text = boundedText(
    source.text ?? source.transcript,
    500000,
    "TRANSCRIPT_TEXT_INVALID",
    "transcript.text",
  );
  if (!text) throw transcriptError("TRANSCRIPT_TEXT_REQUIRED", "Transcript 원문이 필요합니다.");

  const rawSegments = Array.isArray(source.segments) ? source.segments : [];
  const segments = Object.freeze(rawSegments.map((segment, index) => normalizeSegment(segment, index)));
  const durationMs = optionalNumber(
    source.durationMs ?? source.duration_ms ?? (source.durationSeconds ?? context.durationSeconds) * 1000,
    "TRANSCRIPT_DURATION_INVALID",
    "durationMs",
  );

  const normalized = {
    schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
    text,
    segments,
    language: boundedText(source.language ?? context.language, 24, "TRANSCRIPT_LANGUAGE_INVALID", "language") || "ko",
    provider: boundedText(source.provider ?? context.provider, 80, "TRANSCRIPT_PROVIDER_INVALID", "provider"),
    model: boundedText(source.model ?? context.model, 120, "TRANSCRIPT_MODEL_INVALID", "model"),
    providerRequestId: boundedText(
      source.providerRequestId ?? source.provider_request_id ?? source.requestId,
      200,
      "TRANSCRIPT_PROVIDER_REQUEST_ID_INVALID",
      "providerRequestId",
    ),
    durationMs,
    sourceAudioRef: normalizeSourceAudioRef(source.sourceAudioRef ?? source.source_audio_ref ?? context.sourceAudioRef),
    createdAt: (() => {
      const value = source.createdAt ?? source.created_at ?? context.createdAt;
      if (!value) return null;
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) throw transcriptError("TRANSCRIPT_CREATED_AT_INVALID", "createdAt이 올바르지 않습니다.");
      return date.toISOString();
    })(),
  };

  return Object.freeze(normalized);
}
