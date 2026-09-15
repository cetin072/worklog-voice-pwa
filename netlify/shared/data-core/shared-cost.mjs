export const SHARED_COST_CATEGORIES = Object.freeze([
  "database",
  "hosting",
  "domain",
  "storage",
  "network",
  "observability",
  "other",
]);

export const SHARED_COST_ALLOCATION_METHODS = Object.freeze(["equal_active_user"]);

function sharedCostError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function text(value, label, { required = false, max = 0 } = {}) {
  const normalized = String(value ?? "").trim();
  if (required && !normalized) throw sharedCostError(`SHARED_COST_${label}_REQUIRED`, `${label}가 필요합니다.`);
  if (max && normalized.length > max) throw sharedCostError(`SHARED_COST_${label}_INVALID`, `${label}가 허용 길이를 초과했습니다.`);
  return normalized;
}

function monthStart(value) {
  const normalized = text(value, "MONTH_START", { required: true, max: 10 });
  if (!/^\d{4}-\d{2}-01$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) {
    throw sharedCostError("SHARED_COST_MONTH_START_INVALID", "monthStart는 YYYY-MM-01 형식의 월 시작일이어야 합니다.");
  }
  return normalized;
}

function nonNegativeNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw sharedCostError(`SHARED_COST_${label}_INVALID`, `${label}은 0 이상의 유한한 숫자여야 합니다.`);
  }
  return number;
}

function object(value) {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw sharedCostError("SHARED_COST_METADATA_INVALID", "metadata는 객체여야 합니다.");
  }
  return { ...value };
}

export function toSharedCostPoolRow(input = {}) {
  const category = text(input.category, "CATEGORY", { required: true, max: 80 }).toLowerCase();
  if (!SHARED_COST_CATEGORIES.includes(category)) {
    throw sharedCostError("SHARED_COST_CATEGORY_INVALID", "지원하지 않는 shared cost category입니다.");
  }
  const allocationMethod = text(input.allocationMethod ?? "equal_active_user", "ALLOCATION_METHOD", { required: true, max: 80 }).toLowerCase();
  if (!SHARED_COST_ALLOCATION_METHODS.includes(allocationMethod)) {
    throw sharedCostError("SHARED_COST_ALLOCATION_METHOD_INVALID", "지원하지 않는 shared cost allocation method입니다.");
  }

  return Object.freeze({
    month_start: monthStart(input.monthStart),
    cost_key: text(input.costKey, "COST_KEY", { required: true, max: 120 }),
    provider: text(input.provider, "PROVIDER", { required: true, max: 80 }).toLowerCase(),
    category,
    amount_krw: nonNegativeNumber(input.amountKrw, "AMOUNT_KRW"),
    allocation_method: allocationMethod,
    source_note: text(input.sourceNote, "SOURCE_NOTE", { max: 1000 }) || null,
    metadata: object(input.metadata),
  });
}

export function normalizeUserMonthlyCostRow(row = {}) {
  return Object.freeze({
    monthStart: monthStart(row.month_start),
    userId: text(row.user_id, "USER_ID", { required: true, max: 200 }),
    workspaceId: text(row.workspace_id, "WORKSPACE_ID", { required: true, max: 200 }),
    directCostKrw: nonNegativeNumber(row.direct_cost_krw ?? 0, "DIRECT_COST_KRW"),
    allocatedSharedCostKrw: nonNegativeNumber(row.allocated_shared_cost_krw ?? 0, "ALLOCATED_SHARED_COST_KRW"),
    totalCostKrw: nonNegativeNumber(row.total_cost_krw ?? 0, "TOTAL_COST_KRW"),
  });
}

export function createUnconfiguredSharedCostAdmin() {
  const unavailable = async () => {
    throw sharedCostError("SHARED_COST_ADMIN_NOT_CONFIGURED", "Trusted shared cost admin writer가 아직 연결되지 않았습니다.");
  };
  return Object.freeze({
    configured: false,
    upsertPool: unavailable,
    recalculateMonth: unavailable,
  });
}
