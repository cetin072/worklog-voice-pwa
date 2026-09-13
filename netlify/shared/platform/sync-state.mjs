import { requireWorkspaceContext } from "./workspace-context.mjs";

export const SYNC_STATE_SCHEMA_VERSION = "v1";
export const SYNC_STATUSES = Object.freeze(["local", "pending", "synced", "failed"]);
const TOKEN_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/;

function syncError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function text(value) {
  return String(value ?? "").trim();
}

function token(value, code, label) {
  const normalized = text(value).toLowerCase();
  if (!normalized) throw syncError(`${code}_REQUIRED`, `${label}가 필요합니다.`);
  if (!TOKEN_PATTERN.test(normalized)) throw syncError(`${code}_INVALID`, `${label} 형식이 올바르지 않습니다.`);
  return normalized;
}

function identifier(value, code, label) {
  const normalized = text(value);
  if (!normalized) throw syncError(`${code}_REQUIRED`, `${label}가 필요합니다.`);
  if (normalized.length > 200) throw syncError(`${code}_INVALID`, `${label}가 허용 길이를 초과했습니다.`);
  return normalized;
}

function optionalText(value, max, code, label) {
  const normalized = text(value);
  if (normalized.length > max) throw syncError(code, `${label}가 허용 길이를 초과했습니다.`);
  return normalized;
}

function date(value, fallback, code) {
  const source = value ?? fallback;
  const parsed = source instanceof Date ? source : new Date(source);
  if (Number.isNaN(parsed.getTime())) throw syncError(code, "Sync 시각이 올바르지 않습니다.");
  return parsed.toISOString();
}

function optionalDate(value, code) {
  if (value === null || value === undefined || value === "") return null;
  return date(value, undefined, code);
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

export function normalizeSyncState(raw = {}, context = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const owner = ownerContext(source, context);
  const status = text(source.status).toLowerCase();
  if (!SYNC_STATUSES.includes(status)) throw syncError("SYNC_STATUS_INVALID", "Sync status가 올바르지 않습니다.");
  const syncedAt = optionalDate(source.syncedAt ?? source.synced_at, "SYNC_SYNCED_AT_INVALID");
  const errorCode = optionalText(source.errorCode ?? source.error_code, 100, "SYNC_ERROR_CODE_INVALID", "errorCode");
  const errorMessage = optionalText(source.errorMessage ?? source.error_message, 1000, "SYNC_ERROR_MESSAGE_INVALID", "errorMessage");
  if (status === "synced" && !syncedAt) throw syncError("SYNC_SYNCED_AT_REQUIRED", "synced 상태에는 syncedAt이 필요합니다.");
  if (status === "failed" && !errorCode && !errorMessage) throw syncError("SYNC_ERROR_REQUIRED", "failed 상태에는 오류 정보가 필요합니다.");
  const metadata = source.metadata === undefined || source.metadata === null
    ? {}
    : source.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw syncError("SYNC_METADATA_INVALID", "Sync metadata는 객체여야 합니다.");
  }

  return Object.freeze({
    schemaVersion: SYNC_STATE_SCHEMA_VERSION,
    recordType: token(source.recordType ?? source.record_type, "SYNC_RECORD_TYPE", "recordType"),
    recordId: identifier(source.recordId ?? source.record_id, "SYNC_RECORD_ID", "recordId"),
    userId: owner.userId,
    workspaceId: owner.workspaceId,
    status,
    lastAttemptAt: optionalDate(source.lastAttemptAt ?? source.last_attempt_at, "SYNC_LAST_ATTEMPT_AT_INVALID"),
    syncedAt,
    errorCode,
    errorMessage,
    updatedAt: date(source.updatedAt ?? source.updated_at, context.now ?? new Date(), "SYNC_UPDATED_AT_INVALID"),
    metadata: Object.freeze({ ...metadata }),
  });
}
