function text(value, max = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function nonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function integer(value) {
  return Math.round(nonNegative(value));
}

export function buildUsageEventKey(input = {}) {
  const requestId = text(input.requestId, 200);
  const service = text(input.service, 80).toLowerCase();
  const providerRequestId = text(input.providerRequestId, 200);
  const feature = text(input.feature, 100).toLowerCase();
  if (!requestId || !service) {
    const error = new Error("USAGE_EVENT_KEY_REQUIRES_REQUEST_AND_SERVICE");
    error.code = "USAGE_EVENT_KEY_REQUIRES_REQUEST_AND_SERVICE";
    throw error;
  }
  return [requestId, service, providerRequestId || feature || "event"].join(":");
}

export function normalizeUsageLedgerEvent(raw = {}, context = {}) {
  const requestId = text(raw.requestId ?? context.requestId, 200);
  const service = text(raw.service ?? context.service, 80).toLowerCase();
  const feature = text(raw.feature ?? context.feature, 100).toLowerCase();
  const providerRequestId = text(raw.providerRequestId ?? context.providerRequestId, 200);
  const eventKey = text(raw.eventKey, 500) || buildUsageEventKey({ requestId, service, providerRequestId, feature });

  return Object.freeze({
    eventKey,
    requestId,
    feature,
    service,
    provider: text(raw.provider, 80).toLowerCase(),
    model: text(raw.model, 120),
    audioSeconds: nonNegative(raw.audioSeconds ?? raw.durationSeconds),
    inputTokens: integer(raw.inputTokens),
    outputTokens: integer(raw.outputTokens),
    storageBytes: integer(raw.storageBytes),
    apiCalls: Math.max(1, integer(raw.apiCalls || 1)),
    nativeCost: nonNegative(raw.nativeCost),
    nativeCurrency: text(raw.nativeCurrency, 8).toUpperCase() || "KRW",
    estimatedCostKrw: nonNegative(raw.estimatedCostKrw),
    actualCostKrw: raw.actualCostKrw === null || raw.actualCostKrw === undefined || raw.actualCostKrw === ""
      ? null
      : nonNegative(raw.actualCostKrw),
    relatedType: text(raw.relatedType ?? context.relatedType, 80),
    relatedId: text(raw.relatedId ?? context.relatedId, 200),
    providerRequestId,
    status: ["success", "failed", "cancelled"].includes(raw.status) ? raw.status : "success",
    metadata: raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata) ? raw.metadata : {},
  });
}

export function createUnconfiguredUsageLedgerAdapter() {
  return Object.freeze({
    configured: false,
    async record() {
      const error = new Error("중앙 usage ledger가 아직 연결되지 않았습니다.");
      error.code = "USAGE_LEDGER_NOT_CONFIGURED";
      throw error;
    },
  });
}
