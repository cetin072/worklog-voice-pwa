import { invokeAdapter } from "./platform/adapter-boundary.mjs";
import { verifyCallPreparedAudio } from "./call-storage-adapter.mjs";
import { normalizeCallSttResult } from "./call-transcript-adapter.mjs";

function transcriptionError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function rawText(value) {
  return String(value ?? "").trim();
}

function assertSttAdapterIdentity(adapter) {
  if (!adapter || typeof adapter !== "object") {
    throw transcriptionError("CALL_STT_ADAPTER_REQUIRED", "STT adapter가 필요합니다.");
  }
  if (rawText(adapter.service).toLowerCase() !== "stt") {
    throw transcriptionError("CALL_STT_ADAPTER_SERVICE_REQUIRED", "통화 전사에는 service=stt adapter가 필요합니다.");
  }
  if (rawText(adapter.operation).toLowerCase() !== "transcribe") {
    throw transcriptionError("CALL_STT_ADAPTER_OPERATION_REQUIRED", "통화 전사에는 operation=transcribe adapter가 필요합니다.");
  }
  return adapter;
}

function canonicalProviderInput(preparedAudio, language) {
  return Object.freeze({
    audio: Object.freeze({
      uploadId: preparedAudio.uploadId,
      objectPath: preparedAudio.objectPath,
      mimeType: preparedAudio.mimeType,
      sizeBytes: preparedAudio.sizeBytes,
      fileName: preparedAudio.fileName,
      expiresAt: preparedAudio.effectiveExpiresAt,
    }),
    language: rawText(language || "ko") || "ko",
  });
}

function bindEnvelopeToVerifiedAudio(envelope, preparedAudio) {
  const result = envelope?.result && typeof envelope.result === "object" && !Array.isArray(envelope.result)
    ? envelope.result
    : {};
  const segments = Array.isArray(result.segments)
    ? result.segments.map((segment) => ({
      ...(segment && typeof segment === "object" && !Array.isArray(segment) ? segment : {}),
      sourceAudioRef: preparedAudio.sourceAudioRef,
    }))
    : result.segments;

  return {
    ...envelope,
    result: {
      ...result,
      sourceAudioRef: preparedAudio.sourceAudioRef,
      ...(Array.isArray(segments) ? { segments } : {}),
    },
  };
}

export async function runCallTranscription(input = {}, deps = {}, context = {}) {
  const sttAdapter = assertSttAdapterIdentity(deps.sttAdapter);
  const preparedAudio = await verifyCallPreparedAudio(
    deps.storageAdapter,
    {
      job: input.job,
      preparedUpload: input.preparedUpload,
    },
    {
      now: context.now,
      maxRetentionHours: context.maxRetentionHours,
    },
  );

  const providerInput = canonicalProviderInput(preparedAudio, input.language);
  const envelope = await invokeAdapter(sttAdapter, providerInput, Object.freeze({
    jobId: preparedAudio.jobId,
    requestId: preparedAudio.requestId,
    userId: preparedAudio.userId,
    workspaceId: preparedAudio.workspaceId,
    sourceAudioRef: preparedAudio.sourceAudioRef,
  }));

  const normalized = normalizeCallSttResult(
    bindEnvelopeToVerifiedAudio(envelope, preparedAudio),
    {
      sourceAudioRef: preparedAudio.sourceAudioRef,
      language: input.language,
      durationSeconds: input.durationSeconds,
      createdAt: input.createdAt,
    },
  );

  return Object.freeze({
    preparedAudio,
    transcript: normalized.transcript,
    usage: normalized.usage,
    adapter: normalized.adapter,
  });
}
