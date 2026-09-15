import { normalizeUsageEvent } from "../platform/usage-event.mjs";

function nullable(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export function toUsageEventRow(raw = {}, context = {}) {
  const event = normalizeUsageEvent(raw, context);
  return Object.freeze({
    schema_version: event.schemaVersion,
    workspace_id: event.workspaceId,
    user_id: event.userId,
    event_key: event.eventKey,
    request_id: event.requestId,
    job_id: nullable(event.jobId),
    feature: event.feature,
    service: event.service,
    operation: nullable(event.operation),
    provider: nullable(event.provider),
    model: nullable(event.model),
    provider_request_id: nullable(event.providerRequestId),
    related_type: nullable(event.relatedType),
    related_id: nullable(event.relatedId),
    status: event.status,
    audio_seconds: event.audioSeconds,
    input_tokens: event.inputTokens,
    output_tokens: event.outputTokens,
    image_count: event.imageCount,
    storage_bytes: event.storageBytes,
    api_calls: event.apiCalls,
    native_cost: event.nativeCost,
    native_currency: event.nativeCurrency,
    estimated_cost_krw: event.estimatedCostKrw,
    actual_cost_krw: event.actualCostKrw,
    pricing_version: nullable(event.pricingVersion),
    metadata: { ...event.metadata },
    created_at: event.createdAt,
  });
}

export function createUnconfiguredDataCoreUsageWriter() {
  return Object.freeze({
    configured: false,
    async record() {
      const error = new Error("Trusted Data Core usage writer가 아직 연결되지 않았습니다.");
      error.code = "DATA_CORE_USAGE_WRITER_NOT_CONFIGURED";
      throw error;
    },
  });
}
