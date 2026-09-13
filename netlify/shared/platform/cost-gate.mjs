import { requireWorkspaceContext } from "./workspace-context.mjs";

export const COST_GATE_SCHEMA_VERSION = "v1";
const TOKEN_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

function gateError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function text(value) {
  return String(value ?? "").trim();
}

function token(value, code, label) {
  const normalized = text(value).toLowerCase();
  if (!normalized) throw gateError(`${code}_REQUIRED`, `${label}가 필요합니다.`);
  if (!TOKEN_PATTERN.test(normalized)) throw gateError(`${code}_INVALID`, `${label} 형식이 올바르지 않습니다.`);
  return normalized;
}

function validDate(value, fallback) {
  const source = value ?? fallback;
  const date = source instanceof Date ? source : new Date(source);
  if (Number.isNaN(date.getTime())) throw gateError("COST_GATE_EVALUATED_AT_INVALID", "Cost Gate 판정 시각이 올바르지 않습니다.");
  return date.toISOString();
}

function ownerContext(source, context) {
  const workspaceContext = context?.workspaceContext ?? source.workspaceContext;
  if (workspaceContext) return requireWorkspaceContext(workspaceContext);
  return requireWorkspaceContext({
    userId: source.userId ?? source.user_id ?? context.userId ?? context.user_id,
    workspaceId: source.workspaceId ?? source.workspace_id ?? context.workspaceId ?? context.workspace_id,
    role: source.role ?? context.role,
  });
}

function nonNegativeInteger(value, code, label, max = 100) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > max) {
    throw gateError(code, `${label}는 0~${max} 정수여야 합니다.`);
  }
  return number;
}

export function normalizeCostGateDecision(raw = {}, context = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const owner = ownerContext(source, context);
  if (typeof source.allowed !== "boolean") {
    throw gateError("COST_GATE_ALLOWED_REQUIRED", "Cost Gate decision에는 allowed boolean이 필요합니다.");
  }
  const metadata = source.metadata === undefined || source.metadata === null ? {} : source.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw gateError("COST_GATE_METADATA_INVALID", "Cost Gate metadata는 객체여야 합니다.");
  }

  return Object.freeze({
    schemaVersion: COST_GATE_SCHEMA_VERSION,
    feature: token(source.feature ?? context.feature, "COST_GATE_FEATURE", "feature"),
    service: token(source.service ?? context.service, "COST_GATE_SERVICE", "service"),
    allowed: source.allowed,
    reason: token(source.reason, "COST_GATE_REASON", "reason"),
    userId: owner.userId,
    workspaceId: owner.workspaceId,
    evaluatedAt: validDate(source.evaluatedAt ?? source.evaluated_at, context.now ?? new Date()),
    metadata: Object.freeze({ ...metadata }),
  });
}

export function evaluateApprovalCostGate(input = {}, context = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  if (typeof source.explicitlyEnabled !== "boolean") {
    throw gateError("COST_GATE_ENABLED_REQUIRED", "explicitlyEnabled boolean이 필요합니다.");
  }
  if (source.requiredApprovals === undefined || source.requiredApprovals === null) {
    throw gateError("COST_GATE_REQUIRED_APPROVALS_REQUIRED", "requiredApprovals를 명시해야 합니다.");
  }
  const approvalCount = nonNegativeInteger(
    source.approvalCount,
    "COST_GATE_APPROVAL_COUNT_INVALID",
    "approvalCount",
  );
  const requiredApprovals = nonNegativeInteger(
    source.requiredApprovals,
    "COST_GATE_REQUIRED_APPROVALS_INVALID",
    "requiredApprovals",
  );
  const allowed = source.explicitlyEnabled && approvalCount >= requiredApprovals;
  const reason = allowed
    ? "approved"
    : !source.explicitlyEnabled
      ? "paid_processing_disabled"
      : "insufficient_approvals";

  return normalizeCostGateDecision({
    feature: source.feature,
    service: source.service,
    allowed,
    reason,
    workspaceContext: source.workspaceContext,
    evaluatedAt: source.evaluatedAt,
    metadata: {
      approvalCount,
      requiredApprovals,
      explicitlyEnabled: source.explicitlyEnabled,
    },
  }, context);
}

export function assertCostGateAllowed(decisionInput, context = {}) {
  const decision = normalizeCostGateDecision(decisionInput, context);
  if (!decision.allowed) {
    const error = gateError("COST_GATE_NOT_ALLOWED", `유료 기능 실행이 허용되지 않았습니다: ${decision.reason}`);
    error.reason = decision.reason;
    error.feature = decision.feature;
    error.service = decision.service;
    throw error;
  }
  return decision;
}

export function createUnconfiguredCostGateEvaluator() {
  return Object.freeze({
    configured: false,
    async evaluate() {
      throw gateError("COST_GATE_EVALUATOR_NOT_CONFIGURED", "Cost Gate evaluator가 아직 연결되지 않았습니다.");
    },
  });
}
