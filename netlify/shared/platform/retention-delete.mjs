import { requireWorkspaceContext } from "./workspace-context.mjs";

export const RETENTION_DELETE_SCHEMA_VERSION = "v1";
export const DELETE_STATUSES = Object.freeze(["none", "requested", "completed", "failed"]);
const TOKEN_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/;

function retentionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function text(value) {
  return String(value ?? "").trim();
}

function token(value, code, label) {
  const normalized = text(value).toLowerCase();
  if (!normalized) throw retentionError(`${code}_REQUIRED`, `${label}가 필요합니다.`);
  if (!TOKEN_PATTERN.test(normalized)) throw retentionError(`${code}_INVALID`, `${label} 형식이 올바르지 않습니다.`);
  return normalized;
}

function identifier(value, code, label) {
  const normalized = text(value);
  if (!normalized) throw retentionError(`${code}_REQUIRED`, `${label}가 필요합니다.`);
  if (normalized.length > 200) throw retentionError(`${code}_INVALID`, `${label}가 허용 길이를 초과했습니다.`);
  return normalized;
}

function optionalText(value, max, code, label) {
  const normalized = text(value);
  if (normalized.length > max) throw retentionError(code, `${label}가 허용 길이를 초과했습니다.`);
  return normalized;
}

function date(value, code) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw retentionError(code, "Retention/Delete 시각이 올바르지 않습니다.");
  return parsed;
}

function optionalDate(value, code) {
  if (value === null || value === undefined || value === "") return null;
  return date(value, code).toISOString();
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

export function normalizeRetentionDeleteState(raw = {}, context = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const owner = ownerContext(source, context);
  const deleteStatus = text(source.deleteStatus ?? source.delete_status ?? "none").toLowerCase();
  if (!DELETE_STATUSES.includes(deleteStatus)) {
    throw retentionError("DELETE_STATUS_INVALID", "deleteStatus가 올바르지 않습니다.");
  }
  const deleteRequestedAt = optionalDate(
    source.deleteRequestedAt ?? source.delete_requested_at,
    "DELETE_REQUESTED_AT_INVALID",
  );
  const deleteCompletedAt = optionalDate(
    source.deleteCompletedAt ?? source.delete_completed_at,
    "DELETE_COMPLETED_AT_INVALID",
  );
  const deleteErrorCode = optionalText(
    source.deleteErrorCode ?? source.delete_error_code,
    100,
    "DELETE_ERROR_CODE_INVALID",
    "deleteErrorCode",
  );
  const deleteErrorMessage = optionalText(
    source.deleteErrorMessage ?? source.delete_error_message,
    1000,
    "DELETE_ERROR_MESSAGE_INVALID",
    "deleteErrorMessage",
  );

  if (["requested", "completed", "failed"].includes(deleteStatus) && !deleteRequestedAt) {
    throw retentionError("DELETE_REQUESTED_AT_REQUIRED", `${deleteStatus} 상태에는 deleteRequestedAt이 필요합니다.`);
  }
  if (deleteStatus === "completed" && !deleteCompletedAt) {
    throw retentionError("DELETE_COMPLETED_AT_REQUIRED", "completed 상태에는 deleteCompletedAt이 필요합니다.");
  }
  if (deleteStatus === "completed" && new Date(deleteCompletedAt) < new Date(deleteRequestedAt)) {
    throw retentionError("DELETE_COMPLETION_ORDER_INVALID", "deleteCompletedAt은 deleteRequestedAt보다 빠를 수 없습니다.");
  }
  if (deleteStatus === "failed" && !deleteErrorCode && !deleteErrorMessage) {
    throw retentionError("DELETE_ERROR_REQUIRED", "failed 삭제 상태에는 오류 정보가 필요합니다.");
  }
  if (deleteStatus === "none" && (deleteRequestedAt || deleteCompletedAt || deleteErrorCode || deleteErrorMessage)) {
    throw retentionError("DELETE_STATE_INCONSISTENT", "none 삭제 상태에는 삭제 진행 정보가 있을 수 없습니다.");
  }
  if (deleteStatus === "requested" && (deleteCompletedAt || deleteErrorCode || deleteErrorMessage)) {
    throw retentionError("DELETE_STATE_INCONSISTENT", "requested 상태에는 완료/실패 정보가 있을 수 없습니다.");
  }
  if (deleteStatus === "completed" && (deleteErrorCode || deleteErrorMessage)) {
    throw retentionError("DELETE_STATE_INCONSISTENT", "completed 상태에는 실패 정보가 있을 수 없습니다.");
  }
  if (deleteStatus === "failed" && deleteCompletedAt) {
    throw retentionError("DELETE_STATE_INCONSISTENT", "failed 상태에는 deleteCompletedAt이 있을 수 없습니다.");
  }

  const metadata = source.metadata === undefined || source.metadata === null ? {} : source.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw retentionError("RETENTION_METADATA_INVALID", "Retention metadata는 객체여야 합니다.");
  }

  return Object.freeze({
    schemaVersion: RETENTION_DELETE_SCHEMA_VERSION,
    recordType: token(source.recordType ?? source.record_type, "RETENTION_RECORD_TYPE", "recordType"),
    recordId: identifier(source.recordId ?? source.record_id, "RETENTION_RECORD_ID", "recordId"),
    userId: owner.userId,
    workspaceId: owner.workspaceId,
    retentionPolicy: token(
      source.retentionPolicy ?? source.retention_policy,
      "RETENTION_POLICY",
      "retentionPolicy",
    ),
    expiresAt: optionalDate(source.expiresAt ?? source.expires_at, "RETENTION_EXPIRES_AT_INVALID"),
    deleteStatus,
    deleteRequestedAt,
    deleteCompletedAt,
    deleteErrorCode,
    deleteErrorMessage,
    metadata: Object.freeze({ ...metadata }),
  });
}

export function isRetentionExpired(stateInput, at = new Date()) {
  const source = stateInput && typeof stateInput === "object" && !Array.isArray(stateInput) ? stateInput : {};
  const expiresAt = optionalDate(source.expiresAt ?? source.expires_at, "RETENTION_EXPIRES_AT_INVALID");
  if (!expiresAt) return false;
  return date(at, "RETENTION_OBSERVED_AT_INVALID") >= new Date(expiresAt);
}
