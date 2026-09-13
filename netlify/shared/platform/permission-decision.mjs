import { requireWorkspaceContext } from "./workspace-context.mjs";

export const PERMISSION_DECISION_SCHEMA_VERSION = "v1";
const TOKEN_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

function permissionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function text(value) {
  return String(value ?? "").trim();
}

function permissionToken(value) {
  const normalized = text(value).toLowerCase();
  if (!normalized) throw permissionError("PERMISSION_NAME_REQUIRED", "permission 이름이 필요합니다.");
  if (!TOKEN_PATTERN.test(normalized)) {
    throw permissionError("PERMISSION_NAME_INVALID", "permission 이름 형식이 올바르지 않습니다.");
  }
  return normalized;
}

function boundedText(value, max, code, label) {
  const normalized = text(value);
  if (normalized.length > max) throw permissionError(code, `${label}가 허용 길이를 초과했습니다.`);
  return normalized;
}

function validDate(value, fallback) {
  const source = value ?? fallback;
  const date = source instanceof Date ? source : new Date(source);
  if (Number.isNaN(date.getTime())) {
    throw permissionError("PERMISSION_EVALUATED_AT_INVALID", "권한 판정 시각이 올바르지 않습니다.");
  }
  return date.toISOString();
}

function ownerContext(raw, context) {
  const workspaceContext = context?.workspaceContext ?? raw?.workspaceContext;
  if (workspaceContext) return requireWorkspaceContext(workspaceContext);
  return requireWorkspaceContext({
    userId: raw?.userId ?? raw?.user_id ?? context?.userId ?? context?.user_id,
    workspaceId: raw?.workspaceId ?? raw?.workspace_id ?? context?.workspaceId ?? context?.workspace_id,
    role: raw?.role ?? context?.role,
  });
}

export function normalizePermissionDecision(raw = {}, context = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const owner = ownerContext(source, context);
  if (typeof source.allowed !== "boolean") {
    throw permissionError("PERMISSION_ALLOWED_REQUIRED", "permission decision에는 allowed boolean이 필요합니다.");
  }

  return Object.freeze({
    schemaVersion: PERMISSION_DECISION_SCHEMA_VERSION,
    permission: permissionToken(source.permission ?? context.permission),
    allowed: source.allowed,
    userId: owner.userId,
    workspaceId: owner.workspaceId,
    role: owner.role,
    reason: boundedText(source.reason, 500, "PERMISSION_REASON_INVALID", "reason"),
    evaluatedAt: validDate(source.evaluatedAt ?? source.evaluated_at, context.now ?? new Date()),
  });
}

export function createUnconfiguredPermissionEvaluator() {
  return Object.freeze({
    configured: false,
    async evaluate() {
      throw permissionError("PERMISSION_EVALUATOR_NOT_CONFIGURED", "Permission evaluator가 아직 연결되지 않았습니다.");
    },
  });
}
