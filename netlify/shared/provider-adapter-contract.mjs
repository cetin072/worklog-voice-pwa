import { normalizeCallAnalysisResult } from "./call-analysis-normalize.mjs";

export const STT_PROVIDER_IDS = Object.freeze(["openai", "clova", "assemblyai"]);
export const AI_PROVIDER_IDS = Object.freeze(["openai"]);

function text(value, max = 4000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function nonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}

function normalizeUsage(raw = {}, service) {
  return {
    feature: text(raw.feature, 80) || (service === "stt" ? "call_transcription" : "call_summary"),
    service,
    provider: text(raw.provider, 80),
    model: text(raw.model, 120),
    audioSeconds: service === "stt" ? nonNegative(raw.audioSeconds ?? raw.durationSeconds) : 0,
    inputTokens: integer(raw.inputTokens),
    outputTokens: integer(raw.outputTokens),
    apiCalls: Math.max(1, integer(raw.apiCalls, 1)),
    nativeCost: nonNegative(raw.nativeCost),
    nativeCurrency: text(raw.nativeCurrency, 8).toUpperCase() || "KRW",
    estimatedCostKrw: nonNegative(raw.estimatedCostKrw),
    actualCostKrw: raw.actualCostKrw === null || raw.actualCostKrw === undefined || raw.actualCostKrw === ""
      ? null
      : nonNegative(raw.actualCostKrw),
    status: ["success", "failed", "cancelled"].includes(raw.status) ? raw.status : "success",
  };
}

function normalizeSegment(value, index) {
  if (!value || typeof value !== "object") return null;
  const segmentText = text(value.text ?? value.transcript, 4000);
  if (!segmentText) return null;
  const startSeconds = nonNegative(value.startSeconds ?? value.start ?? 0);
  const rawEnd = value.endSeconds ?? value.end;
  const endSeconds = rawEnd === null || rawEnd === undefined || rawEnd === ""
    ? null
    : nonNegative(rawEnd);
  if (endSeconds !== null && endSeconds < startSeconds) return null;
  return {
    index,
    speaker: text(value.speaker ?? value.speakerLabel, 80) || "unknown",
    startSeconds,
    endSeconds,
    text: segmentText,
  };
}

export function normalizeSttAdapterResult(raw = {}, context = {}) {
  const transcript = text(raw.transcript ?? raw.text, 200000);
  if (!transcript) throw new Error("STT_EMPTY_TRANSCRIPT");

  const segments = [];
  for (const [index, candidate] of (Array.isArray(raw.segments) ? raw.segments : []).entries()) {
    const segment = normalizeSegment(candidate, index);
    if (segment) segments.push(segment);
  }

  const provider = text(raw.provider ?? context.provider, 80);
  const model = text(raw.model ?? context.model, 120);
  const usage = normalizeUsage({ ...(raw.usage || {}), provider, model }, "stt");
  if (!usage.audioSeconds) usage.audioSeconds = nonNegative(context.audioSeconds);

  return {
    transcript,
    segments,
    language: text(raw.language ?? context.language, 24) || "ko",
    provider,
    model,
    providerRequestId: text(raw.providerRequestId ?? raw.requestId, 200),
    usage,
  };
}

export function normalizeAiAdapterResult(raw = {}, context = {}) {
  const provider = text(raw.provider ?? context.provider, 80);
  const model = text(raw.model ?? context.model, 120);
  const source = raw.analysis && typeof raw.analysis === "object" ? raw.analysis : raw;
  const analysis = normalizeCallAnalysisResult(source, { recordedAt: context.recordedAt || new Date() });
  const report = analysis.report || {};
  const hasReport = Boolean(
    report.headline || report.overview ||
    report.discussionPoints?.length || report.counterpartRequests?.length ||
    report.userCommitments?.length || report.decisions?.length || report.openQuestions?.length,
  );
  const hasContent = Boolean(
    analysis.title || analysis.summary || analysis.keyPoints.length || analysis.actions.length || analysis.contacts.length || hasReport,
  );
  if (!hasContent) throw new Error("AI_EMPTY_ANALYSIS");

  return {
    analysis,
    provider,
    model,
    providerRequestId: text(raw.providerRequestId ?? raw.requestId, 200),
    usage: normalizeUsage({ ...(raw.usage || {}), provider, model }, "ai"),
  };
}

export function createUnconfiguredProviderAdapter({ provider, service }) {
  const safeProvider = text(provider, 80) || "unknown";
  const safeService = service === "ai" ? "ai" : "stt";
  return Object.freeze({
    provider: safeProvider,
    service: safeService,
    configured: false,
    async run() {
      const error = new Error(`${safeProvider} ${safeService.toUpperCase()} 공급자는 아직 연결되지 않았습니다.`);
      error.code = "PROVIDER_NOT_CONFIGURED";
      throw error;
    },
  });
}

export function defaultProviderRegistry() {
  return Object.freeze({
    stt: Object.freeze({
      openai: createUnconfiguredProviderAdapter({ provider: "openai", service: "stt" }),
      clova: createUnconfiguredProviderAdapter({ provider: "clova", service: "stt" }),
      assemblyai: createUnconfiguredProviderAdapter({ provider: "assemblyai", service: "stt" }),
    }),
    ai: Object.freeze({
      openai: createUnconfiguredProviderAdapter({ provider: "openai", service: "ai" }),
    }),
  });
}
