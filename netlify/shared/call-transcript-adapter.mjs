import { normalizeAdapterEnvelope } from "./platform/adapter-boundary.mjs";
import { normalizeTranscript } from "./platform/transcript-contract.mjs";

function adapterError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function rawText(value) {
  return String(value ?? "").trim();
}

function inferTranscriptResult(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (source.result && typeof source.result === "object" && !Array.isArray(source.result)) return source.result;
  return source;
}

export function normalizeCallSttResult(raw = {}, context = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const result = inferTranscriptResult(source);
  const service = rawText(source.service || context.service || "stt").toLowerCase();
  if (service !== "stt") {
    throw adapterError("CALL_TRANSCRIPT_STT_SERVICE_REQUIRED", "Call Transcript adapter에는 STT 결과가 필요합니다.");
  }

  const provider = rawText(source.provider ?? result.provider ?? context.provider).toLowerCase();
  if (!provider) throw adapterError("CALL_TRANSCRIPT_PROVIDER_REQUIRED", "STT provider가 필요합니다.");

  const envelope = normalizeAdapterEnvelope({
    model: source.model ?? result.model,
    providerRequestId: source.providerRequestId ?? result.providerRequestId ?? result.requestId,
    result: {
      ...result,
      text: result.text ?? result.transcript,
    },
    usage: source.usage ?? result.usage ?? null,
    metadata: source.metadata ?? {},
  }, {
    service: "stt",
    provider,
    operation: rawText(source.operation ?? context.operation ?? "transcribe").toLowerCase(),
  });

  const transcript = normalizeTranscript({
    ...envelope.result,
    provider: envelope.provider,
    model: envelope.model,
    providerRequestId: envelope.providerRequestId,
  }, {
    provider: envelope.provider,
    model: envelope.model,
    language: context.language,
    durationSeconds: context.durationSeconds,
    sourceAudioRef: context.sourceAudioRef,
    createdAt: context.createdAt,
  });

  return Object.freeze({
    transcript,
    usage: envelope.usage,
    adapter: Object.freeze({
      schemaVersion: envelope.schemaVersion,
      service: envelope.service,
      provider: envelope.provider,
      operation: envelope.operation,
      model: envelope.model,
      providerRequestId: envelope.providerRequestId,
      metadata: envelope.metadata,
    }),
  });
}
