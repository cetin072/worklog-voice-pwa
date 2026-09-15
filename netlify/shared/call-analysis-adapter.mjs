import { invokeAdapter } from "./platform/adapter-boundary.mjs";
import { normalizeTranscript } from "./platform/transcript-contract.mjs";
import { buildCallAnalysisInstruction } from "./call-analysis-contract.mjs";
import { normalizeCallAnalysisResult } from "./call-analysis-normalize.mjs";

function analysisError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function rawText(value) {
  return String(value ?? "").trim();
}

function assertAiAdapterIdentity(adapter) {
  if (!adapter || typeof adapter !== "object") {
    throw analysisError("CALL_AI_ADAPTER_REQUIRED", "AI adapter가 필요합니다.");
  }
  if (rawText(adapter.service).toLowerCase() !== "ai") {
    throw analysisError("CALL_AI_ADAPTER_SERVICE_REQUIRED", "통화 분석에는 service=ai adapter가 필요합니다.");
  }
  if (rawText(adapter.operation).toLowerCase() !== "analyze") {
    throw analysisError("CALL_AI_ADAPTER_OPERATION_REQUIRED", "통화 분석에는 operation=analyze adapter가 필요합니다.");
  }
  return adapter;
}

function providerTranscript(transcript) {
  return Object.freeze({
    text: transcript.text,
    language: transcript.language,
    durationMs: transcript.durationMs,
    segments: Object.freeze(transcript.segments.map((segment) => Object.freeze({
      index: segment.index,
      text: segment.text,
      startMs: segment.startMs,
      endMs: segment.endMs,
      speakerId: segment.speakerId,
      confidence: segment.confidence,
    }))),
  });
}

export async function runCallAnalysis(input = {}, deps = {}, context = {}) {
  const aiAdapter = assertAiAdapterIdentity(deps.aiAdapter);
  const transcript = normalizeTranscript(input.transcript || {}, {
    createdAt: input.createdAt,
  });

  const occurredAt = rawText(input.occurredAt || input.recordedAt);
  const contactName = rawText(input.contactName);
  const instruction = buildCallAnalysisInstruction({ contactName, occurredAt });
  const providerInput = Object.freeze({
    instruction,
    transcript: providerTranscript(transcript),
    context: Object.freeze({ contactName, occurredAt }),
  });

  const envelope = await invokeAdapter(aiAdapter, providerInput, Object.freeze({
    requestId: rawText(context.requestId),
    jobId: rawText(context.jobId),
    userId: rawText(context.userId),
    workspaceId: rawText(context.workspaceId),
  }));

  const result = envelope.result?.analysis && typeof envelope.result.analysis === "object"
    ? envelope.result.analysis
    : envelope.result;
  const analysis = normalizeCallAnalysisResult(result, {
    recordedAt: occurredAt || input.createdAt || new Date(),
  });

  return Object.freeze({
    transcript,
    analysis,
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
