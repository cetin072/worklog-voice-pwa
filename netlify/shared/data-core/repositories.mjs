import { requireWorkspaceContext } from "../platform/workspace-context.mjs";

export const WORK_RECORD_TYPES = Object.freeze([
  "completed_work", "task", "meeting_call", "expense_tax", "delegation", "idea", "issue_review", "other",
]);
export const WORK_RECORD_STATUSES = Object.freeze(["in_progress", "completed", "waiting", "needs_review", "cancelled"]);
export const SCHEDULE_STATUSES = Object.freeze(["confirmed", "tentative", "completed", "cancelled"]);
export const SOURCE_TYPES = Object.freeze(["direct", "voice", "call", "meeting", "mail", "capture", "scan", "notion", "import", "other"]);
export const SOURCE_ENTITY_TYPES = Object.freeze(["work_record", "schedule", "candidate", "call_report", "meeting_report", "scan_document", "mail_analysis", "capture_analysis", "other"]);
export const CANDIDATE_TYPES = Object.freeze(["task", "schedule", "contact", "follow_up"]);
export const CANDIDATE_STATUSES = Object.freeze(["pending", "confirmed", "dismissed"]);

function repositoryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function text(value, label, { required = false, max = 0 } = {}) {
  const normalized = String(value ?? "").trim();
  if (required && !normalized) throw repositoryError(`DATA_CORE_${label}_REQUIRED`, `${label}가 필요합니다.`);
  if (max && normalized.length > max) throw repositoryError(`DATA_CORE_${label}_INVALID`, `${label}가 허용 길이를 초과했습니다.`);
  return normalized;
}

function optionalText(value, label, max) {
  const normalized = text(value, label, { max });
  return normalized || null;
}

function enumValue(value, values, label, fallback) {
  const normalized = text(value ?? fallback, label, { required: true, max: 80 }).toLowerCase();
  if (!values.includes(normalized)) throw repositoryError(`DATA_CORE_${label}_INVALID`, `${label} 값이 올바르지 않습니다.`);
  return normalized;
}

function dateTime(value, label, { required = false } = {}) {
  const normalized = text(value, label, { required, max: 64 });
  if (!normalized) return null;
  if (!Number.isFinite(Date.parse(normalized))) throw repositoryError(`DATA_CORE_${label}_INVALID`, `${label}은 유효한 ISO 날짜/시각이어야 합니다.`);
  return normalized;
}

function object(value, label) {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw repositoryError(`DATA_CORE_${label}_INVALID`, `${label}는 객체여야 합니다.`);
  }
  return { ...value };
}

function optionalNumber(value, label) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw repositoryError(`DATA_CORE_${label}_INVALID`, `${label}은 유한한 숫자여야 합니다.`);
  return number;
}

function booleanValue(value, label, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") throw repositoryError(`DATA_CORE_${label}_INVALID`, `${label}은 boolean이어야 합니다.`);
  return value;
}

function contextFor(input) {
  return requireWorkspaceContext(input?.workspaceContext ?? input);
}

export function toWorkRecordRow(input = {}, contextInput = input) {
  const workspaceContext = contextFor(contextInput);
  return Object.freeze({
    workspace_id: workspaceContext.workspaceId,
    created_by_user_id: workspaceContext.userId,
    assigned_user_id: optionalText(input.assignedUserId, "ASSIGNED_USER_ID", 200),
    title: text(input.title, "WORK_RECORD_TITLE", { required: true, max: 200 }),
    content: text(input.content, "WORK_RECORD_CONTENT", { max: 10000 }),
    original_text: text(input.originalText, "WORK_RECORD_ORIGINAL_TEXT", { max: 10000 }),
    record_type: enumValue(input.recordType, WORK_RECORD_TYPES, "WORK_RECORD_TYPE", "other"),
    status: enumValue(input.status, WORK_RECORD_STATUSES, "WORK_RECORD_STATUS", "in_progress"),
    institution: optionalText(input.institution, "WORK_RECORD_INSTITUTION", 500),
    amount: optionalNumber(input.amount, "WORK_RECORD_AMOUNT"),
    follow_up: optionalText(input.followUp, "WORK_RECORD_FOLLOW_UP", 5000),
    recorded_at: dateTime(input.recordedAt, "WORK_RECORD_RECORDED_AT", { required: true }),
    due_at: dateTime(input.dueAt, "WORK_RECORD_DUE_AT"),
    metadata: object(input.metadata, "WORK_RECORD_METADATA"),
  });
}

export function toScheduleRow(input = {}, contextInput = input) {
  const workspaceContext = contextFor(contextInput);
  const startsAt = dateTime(input.startsAt, "SCHEDULE_STARTS_AT", { required: true });
  const endsAt = dateTime(input.endsAt, "SCHEDULE_ENDS_AT");
  if (endsAt && Date.parse(endsAt) < Date.parse(startsAt)) {
    throw repositoryError("DATA_CORE_SCHEDULE_ENDS_AT_INVALID", "SCHEDULE_ENDS_AT은 시작보다 빠를 수 없습니다.");
  }
  return Object.freeze({
    workspace_id: workspaceContext.workspaceId,
    created_by_user_id: workspaceContext.userId,
    title: text(input.title, "SCHEDULE_TITLE", { required: true, max: 200 }),
    description: text(input.description, "SCHEDULE_DESCRIPTION", { max: 10000 }),
    starts_at: startsAt,
    ends_at: endsAt,
    all_day: booleanValue(input.allDay, "SCHEDULE_ALL_DAY"),
    timezone: text(input.timezone ?? "Asia/Seoul", "SCHEDULE_TIMEZONE", { required: true, max: 64 }),
    status: enumValue(input.status, SCHEDULE_STATUSES, "SCHEDULE_STATUS", "confirmed"),
    location: optionalText(input.location, "SCHEDULE_LOCATION", 1000),
    reminder_at: dateTime(input.reminderAt, "SCHEDULE_REMINDER_AT"),
    metadata: object(input.metadata, "SCHEDULE_METADATA"),
  });
}

export function toSourceRefRow(input = {}, contextInput = input) {
  const workspaceContext = contextFor(contextInput);
  return Object.freeze({
    workspace_id: workspaceContext.workspaceId,
    created_by_user_id: workspaceContext.userId,
    entity_type: enumValue(input.entityType, SOURCE_ENTITY_TYPES, "SOURCE_ENTITY_TYPE"),
    entity_id: text(input.entityId, "SOURCE_ENTITY_ID", { required: true, max: 300 }),
    source_type: enumValue(input.sourceType, SOURCE_TYPES, "SOURCE_TYPE"),
    source_id: optionalText(input.sourceId, "SOURCE_ID", 500),
    source_excerpt: optionalText(input.sourceExcerpt, "SOURCE_EXCERPT", 10000),
    metadata: object(input.metadata, "SOURCE_METADATA"),
  });
}

export function toCandidateRow(input = {}, contextInput = input) {
  const workspaceContext = contextFor(contextInput);
  const status = enumValue(input.status, CANDIDATE_STATUSES, "CANDIDATE_STATUS", "pending");
  const confirmedAt = dateTime(input.confirmedAt, "CANDIDATE_CONFIRMED_AT");
  const confirmedEntityType = optionalText(input.confirmedEntityType, "CANDIDATE_CONFIRMED_ENTITY_TYPE", 100);
  const confirmedEntityId = optionalText(input.confirmedEntityId, "CANDIDATE_CONFIRMED_ENTITY_ID", 300);
  if (status === "confirmed" && (!confirmedAt || !confirmedEntityType || !confirmedEntityId)) {
    throw repositoryError("DATA_CORE_CANDIDATE_CONFIRMATION_REQUIRED", "확정 Candidate에는 확정 시각과 대상 엔티티가 필요합니다.");
  }
  const confidence = input.confidence === undefined || input.confidence === null ? null : optionalNumber(input.confidence, "CANDIDATE_CONFIDENCE");
  if (confidence !== null && (confidence < 0 || confidence > 1)) {
    throw repositoryError("DATA_CORE_CANDIDATE_CONFIDENCE_INVALID", "CANDIDATE_CONFIDENCE는 0과 1 사이여야 합니다.");
  }
  return Object.freeze({
    workspace_id: workspaceContext.workspaceId,
    created_by_user_id: workspaceContext.userId,
    candidate_type: enumValue(input.candidateType, CANDIDATE_TYPES, "CANDIDATE_TYPE"),
    status,
    title: optionalText(input.title, "CANDIDATE_TITLE", 200),
    payload: object(input.payload, "CANDIDATE_PAYLOAD"),
    confidence,
    source_ref_id: optionalText(input.sourceRefId, "CANDIDATE_SOURCE_REF_ID", 200),
    confirmed_entity_type: confirmedEntityType,
    confirmed_entity_id: confirmedEntityId,
    confirmed_at: confirmedAt,
    metadata: object(input.metadata, "CANDIDATE_METADATA"),
  });
}

function requireInsertClient(client) {
  if (!client || typeof client.insert !== "function") {
    throw repositoryError("DATA_CORE_REPOSITORY_CLIENT_REQUIRED", "Data Core insert client가 필요합니다.");
  }
  return client;
}

export function createDataCoreRepositories(clientInput) {
  const client = requireInsertClient(clientInput);
  return Object.freeze({
    workRecords: Object.freeze({ create: async (input, context) => client.insert("work_records", toWorkRecordRow(input, context)) }),
    schedules: Object.freeze({ create: async (input, context) => client.insert("schedules", toScheduleRow(input, context)) }),
    sourceRefs: Object.freeze({ create: async (input, context) => client.insert("source_refs", toSourceRefRow(input, context)) }),
    candidates: Object.freeze({ create: async (input, context) => client.insert("candidates", toCandidateRow(input, context)) }),
  });
}
