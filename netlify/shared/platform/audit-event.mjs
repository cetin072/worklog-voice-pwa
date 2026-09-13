import { requireWorkspaceContext } from "./workspace-context.mjs";

export const AUDIT_EVENT_SCHEMA_VERSION = "v1";
export const AUDIT_OUTCOMES = Object.freeze(["success", "failed", "denied"]);
const TOKEN_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

function auditError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function text(value) {
  return String(value ?? "").trim();
}

function token(value, code, label) {
  const normalized = text(value).toLowerCase();
  if (!normalized) throw auditError(`${code}_REQUIRED`, `${label}가 필요합니다.`);
  if (!TOKEN_PATTERN.test(normalized)) throw auditError(`${code}_INVALID`, `${label} 형식이 올바르지 않습니다.`);
  return normalized;
}

function identifier(value, code, label, required = true) {
  const normalized = text(value);
  if (!normalized && required) throw auditError(`${code}_REQUIRED`, `${label}가 필요합니다.`);
  if (normalized.length > 200) throw auditError(`${code}_INVALID`, `${label}가 허용 길이를 초과했습니다.`);
  return normalized;
}

function validDate(value, fallback) {
  const source = value ?? fallback;
  const parsed = source instanceof Date ? source : new Date(source);
  if (Number.isNaN(parsed.getTime())) throw auditError("AUDIT_OCCURRED_AT_INVALID", "Audit Event 시각이 올바르지 않습니다.");
  return parsed.toISOString();
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

export function normalizeAuditEvent(raw = {}, context = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const owner = ownerContext(source, context);
  const outcome = text(source.outcome).toLowerCase();
  if (!AUDIT_OUTCOMES.includes(outcome)) throw auditError("AUDIT_OUTCOME_INVALID", "Audit outcome이 올바르지 않습니다.");
  const metadata = source.metadata === undefined || source.metadata === null ? {} : source.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw auditError("AUDIT_METADATA_INVALID", "Audit metadata는 객체여야 합니다.");
  }

  return Object.freeze({
    schemaVersion: AUDIT_EVENT_SCHEMA_VERSION,
    eventId: identifier(source.eventId ?? source.event_id, "AUDIT_EVENT_ID", "eventId"),
    userId: owner.userId,
    workspaceId: owner.workspaceId,
    action: token(source.action, "AUDIT_ACTION", "action"),
    targetType: token(source.targetType ?? source.target_type, "AUDIT_TARGET_TYPE", "targetType"),
    targetId: identifier(source.targetId ?? source.target_id, "AUDIT_TARGET_ID", "targetId"),
    outcome,
    requestId: identifier(source.requestId ?? source.request_id, "AUDIT_REQUEST_ID", "requestId", false),
    jobId: identifier(source.jobId ?? source.job_id, "AUDIT_JOB_ID", "jobId", false),
    occurredAt: validDate(source.occurredAt ?? source.occurred_at, context.now ?? new Date()),
    metadata: Object.freeze({ ...metadata }),
  });
}

export function createUnconfiguredAuditWriter() {
  return Object.freeze({
    configured: false,
    async append() {
      throw auditError("AUDIT_WRITER_NOT_CONFIGURED", "Audit writer가 아직 연결되지 않았습니다.");
    },
  });
}
