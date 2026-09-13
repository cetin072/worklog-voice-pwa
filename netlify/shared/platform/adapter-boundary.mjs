export const ADAPTER_ENVELOPE_SCHEMA_VERSION = "v1";

const TOKEN_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const ADAPTER_BRAND = Symbol("platform-adapter-v1");

function adapterError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function rawText(value) {
  return String(value ?? "").trim();
}

function normalizeToken(value, code, label, required = false) {
  const normalized = rawText(value).toLowerCase();
  if (!normalized) {
    if (required) throw adapterError(`${code}_REQUIRED`, `${label}가 필요합니다.`);
    return "";
  }
  if (!TOKEN_PATTERN.test(normalized)) {
    throw adapterError(`${code}_INVALID`, `${label} 형식이 올바르지 않습니다.`);
  }
  return normalized;
}

function boundedText(value, max, code, label) {
  const normalized = rawText(value);
  if (normalized.length > max) throw adapterError(code, `${label}가 허용 길이를 초과했습니다.`);
  return normalized;
}

function plainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function freezeUsage(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    if (!value.every(plainObject)) {
      throw adapterError("ADAPTER_USAGE_INVALID", "normalized usage 배열에는 객체만 허용됩니다.");
    }
    return Object.freeze(value.map((item) => Object.freeze({ ...item })));
  }
  if (!plainObject(value)) {
    throw adapterError("ADAPTER_USAGE_INVALID", "normalized usage는 객체 또는 객체 배열이어야 합니다.");
  }
  return Object.freeze({ ...value });
}

function freezeMetadata(value) {
  if (value === null || value === undefined) return Object.freeze({});
  if (!plainObject(value)) {
    throw adapterError("ADAPTER_METADATA_INVALID", "normalized metadata는 객체여야 합니다.");
  }
  return Object.freeze({ ...value });
}

export function normalizeAdapterIdentity(raw = {}) {
  const source = plainObject(raw) ? raw : {};
  return Object.freeze({
    service: normalizeToken(source.service, "ADAPTER_SERVICE", "service", true),
    provider: normalizeToken(source.provider, "ADAPTER_PROVIDER", "provider", true),
    operation: normalizeToken(source.operation, "ADAPTER_OPERATION", "operation"),
  });
}

export function normalizeAdapterEnvelope(raw = {}, identityInput = {}) {
  const source = plainObject(raw) ? raw : {};
  const identity = normalizeAdapterIdentity(identityInput);
  if (!plainObject(source.result)) {
    throw adapterError("ADAPTER_RESULT_REQUIRED", "normalized adapter 결과에는 result 객체가 필요합니다.");
  }

  return Object.freeze({
    schemaVersion: ADAPTER_ENVELOPE_SCHEMA_VERSION,
    service: identity.service,
    provider: identity.provider,
    operation: identity.operation,
    model: boundedText(source.model, 120, "ADAPTER_MODEL_INVALID", "model"),
    providerRequestId: boundedText(
      source.providerRequestId ?? source.provider_request_id,
      200,
      "ADAPTER_PROVIDER_REQUEST_ID_INVALID",
      "providerRequestId",
    ),
    result: Object.freeze({ ...source.result }),
    usage: freezeUsage(source.usage),
    metadata: freezeMetadata(source.metadata),
  });
}

export function createConfiguredAdapter(config = {}) {
  const identity = normalizeAdapterIdentity(config);
  const run = config.run;
  const normalize = config.normalize;
  if (typeof run !== "function") {
    throw adapterError("ADAPTER_RUN_REQUIRED", "configured adapter에는 run 함수가 필요합니다.");
  }
  if (typeof normalize !== "function") {
    throw adapterError("ADAPTER_NORMALIZE_REQUIRED", "configured adapter에는 normalize 함수가 필요합니다.");
  }

  return Object.freeze({
    [ADAPTER_BRAND]: true,
    ...identity,
    configured: true,
    async invoke(input = {}, context = {}) {
      const raw = await run(input, context);
      const normalized = await normalize(raw, Object.freeze({ ...context, adapter: identity }));
      return normalizeAdapterEnvelope(normalized, identity);
    },
  });
}

export function createUnconfiguredAdapter(identityInput = {}) {
  const identity = normalizeAdapterIdentity(identityInput);
  return Object.freeze({
    [ADAPTER_BRAND]: true,
    ...identity,
    configured: false,
    async invoke() {
      throw adapterError(
        "ADAPTER_NOT_CONFIGURED",
        `${identity.provider} ${identity.service} adapter가 아직 연결되지 않았습니다.`,
      );
    },
  });
}

export async function invokeAdapter(adapter, input = {}, context = {}) {
  if (!adapter || typeof adapter !== "object" || adapter[ADAPTER_BRAND] !== true || typeof adapter.invoke !== "function") {
    throw adapterError("ADAPTER_INVALID", "Platform Adapter Boundary로 생성된 adapter가 필요합니다.");
  }
  if (adapter.configured !== true) {
    throw adapterError("ADAPTER_NOT_CONFIGURED", "연결된 adapter가 필요합니다.");
  }
  return adapter.invoke(input, context);
}
