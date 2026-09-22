import { isTimedScheduleIntent } from "./action-engine-v1.mjs";
import { createDataCoreRepositories } from "./data-core/repositories.mjs";

const TYPE_MAP = Object.freeze({ "완료업무": "completed_work", "할 일": "task", "회의·통화": "meeting_call", "지출·세무": "expense_tax", "지시·위임": "delegation", "아이디어": "idea", "문제·확인": "issue_review", "기타": "other" });
const STATUS_MAP = Object.freeze({ "완료": "completed", "진행중": "in_progress", "대기": "waiting", "확인필요": "needs_review" });
const TRUSTED_FIELD_SOURCES = new Set(["user_selected", "user_confirmed"]);
const SOURCE_TYPES = new Set(["direct", "voice", "call", "meeting", "mail", "capture", "scan", "notion", "import", "other"]);

function adapterError(code, message, details = {}) { const error = new Error(message); error.code = code; Object.assign(error, details); return error; }
function validRecordedAt(value) { const date = new Date(value || ""); return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString(); }
function title(value) { const text = String(value || "").replace(/\s+/g, " ").trim(); return text.length <= 200 ? text : text.slice(0, 200); }
function dueAt(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T00:00:00+09:00`;
  if (/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(text)) return text;
  return null;
}
function amount(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function fieldSource(value) {
  const source = String(value || "").trim().toLowerCase();
  return TRUSTED_FIELD_SOURCES.has(source) ? source : "unverified";
}

function sourceType(value) {
  const source = String(value || "direct").trim().toLowerCase();
  if (!SOURCE_TYPES.has(source)) throw adapterError("WORKLOG_DATA_CORE_SOURCE_TYPE_INVALID", "입력 원본 유형이 올바르지 않습니다.");
  return source;
}
function journalDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function actionKind(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "task" || normalized === "note" ? normalized : null;
}

function confirmedSchedule(row, expectedId) {
  const id = String(row?.id || row?.schedule_id || "").trim();
  const title = String(row?.title || "").trim();
  const startsAt = row?.startsAt || row?.starts_at || row?.schedule_starts_at ? String(row.startsAt || row.starts_at || row.schedule_starts_at) : "";
  const status = String(row?.status || "").trim();
  if (id !== expectedId || !title || !startsAt || !status || !Number.isFinite(new Date(startsAt).getTime())) {
    return null;
  }
  return Object.freeze({ id, title, startsAt, status, allDay: row?.allDay === true || row?.all_day === true || row?.schedule_all_day === true });
}

function snapshotRpcUnavailable(error, name) {
  if (error?.code !== "SUPABASE_DATA_CORE_RPC_FAILED") return false;
  if (String(error?.remoteCode || "") === "PGRST202") return true;
  const message = String(error?.message || "");
  return new RegExp(`(?:could not find|schema cache)[\\s\\S]*${name}|${name}[\\s\\S]*(?:could not find|schema cache)`, "i").test(message);
}

async function invokeSnapshotRpc(client, snapshotName, fallbackName, body) {
  try {
    return { result: await client.rpc(snapshotName, body), hasSnapshot: true };
  } catch (error) {
    if (!snapshotRpcUnavailable(error, snapshotName)) throw error;
    return { result: await client.rpc(fallbackName, body), hasSnapshot: false };
  }
}

function snapshotsFromRow(row, scheduleIds, hasSnapshot) {
  if (!hasSnapshot) return Object.freeze([]);
  const ids = [...new Set(scheduleIds.map((value) => String(value || "").trim()).filter(Boolean))];
  if (!ids.length) return Object.freeze([]);
  const raw = Array.isArray(row?.schedule_snapshots) ? row.schedule_snapshots : [];
  return Object.freeze(ids.map((id) => confirmedSchedule(raw.find((value) => String(value?.id || "").trim() === id), id)).filter(Boolean));
}

export function quickWorklogSchedule(record = {}, normalized = {}) {
  if (!isTimedScheduleIntent({
    source: record.transcript,
    dueStart: record.dueStart,
    recordType: normalized.recordType,
    explicitType: record.type,
  })) return null;
  return Object.freeze({ title: normalized.title, startsAt: normalized.dueAt, timezone: "Asia/Seoul", status: "confirmed" });
}

function normalizedRecord(record = {}) {
  const clientRequestId = String(record.clientRequestId || "").trim();
  if (!/^[A-Za-z0-9-]{16,100}$/.test(clientRequestId)) throw adapterError("WORKLOG_DATA_CORE_REQUEST_ID_REQUIRED", "Data Core 저장에는 유효한 clientRequestId가 필요합니다.");
  const institutionSource = fieldSource(record.institutionSource ?? record.institution_source);
  const requestedInstitution = String(record.institution || "").trim();
  const institution = TRUSTED_FIELD_SOURCES.has(institutionSource) && requestedInstitution ? requestedInstitution : null;
  const normalizedActionKind = actionKind(record.actionKind);
  const normalizedJournalDate = journalDate(record.journalDate);
  const actionEngine = record.actionEngine && typeof record.actionEngine === "object" && !Array.isArray(record.actionEngine)
    ? { ...record.actionEngine, actionKind: normalizedActionKind, journalDate: normalizedJournalDate }
    : null;
  return Object.freeze({
    clientRequestId,
    title: title(record.cleanTranscript),
    content: String(record.cleanTranscript || ""),
    originalText: String(record.transcript || ""),
    recordType: TYPE_MAP[record.type] || "other",
    status: STATUS_MAP[record.status] || "in_progress",
    institution,
    institutionSource,
    amount: amount(record.amount),
    followUp: String(record.followUp || "").trim() || null,
    actionKind: normalizedActionKind,
    journalDate: normalizedJournalDate,
    recordedAt: validRecordedAt(record.recordedAt),
    dueAt: dueAt(record.dueStart),
    metadata: {
      source: "quick_worklog",
      clientRequestId,
      fieldProvenance: { institution: institutionSource },
      ...(actionEngine ? { actionEngine } : {}),
    },
    sourceExcerpt: String(record.transcript || ""),
  });
}

export function createWorklogDataCoreAdapter({ client } = {}) {
  const repositories = createDataCoreRepositories(client);
  return Object.freeze({
    async persistManyFast({ parentRequestId, originalText, source = "direct", recordedAt, records = [] } = {}) {
      if (typeof client?.rpc !== "function") throw adapterError("WORKLOG_DATA_CORE_FAST_RPC_REQUIRED", "Data Core fast save에는 RPC client가 필요합니다.");
      const parentId = String(parentRequestId || "").trim();
      if (!/^[A-Za-z0-9-]{16,100}$/.test(parentId)) throw adapterError("WORKLOG_DATA_CORE_MULTI_PARENT_REQUEST_ID_INVALID", "다중 업무 저장에는 유효한 parent request ID가 필요합니다.");
      const raw = String(originalText || "");
      if (!raw || raw.length > 10000) throw adapterError("WORKLOG_DATA_CORE_MULTI_ORIGINAL_INVALID", "다중 업무 원문이 비어 있거나 너무 깁니다.");
      if (!Array.isArray(records) || records.length < 2 || records.length > 8) throw adapterError("WORKLOG_DATA_CORE_MULTI_RECORDS_INVALID", "다중 업무는 2~8개까지 저장할 수 있습니다.");

      const normalizedRecords = records.map((record) => {
        const normalized = normalizedRecord(record);
        const schedule = quickWorklogSchedule(record, normalized);
        return { normalized, schedule };
      });

      const input = {
        p_parent_request_id: parentId,
        p_original_text: raw,
        p_source_type: sourceType(source),
        p_recorded_at: validRecordedAt(recordedAt),
        p_capture_metadata: { source: "worklog_multi_action", segmentCount: records.length },
        p_items: normalizedRecords.map(({ normalized, schedule }) => ({
          title: normalized.title,
          content: normalized.content,
          originalText: normalized.originalText,
          recordType: normalized.recordType,
          status: normalized.status,
          institution: normalized.institution,
          amount: normalized.amount,
          followUp: normalized.followUp,
          recordedAt: normalized.recordedAt,
          dueAt: normalized.dueAt,
          metadata: normalized.metadata,
          sourceExcerpt: normalized.sourceExcerpt,
          scheduleTitle: schedule?.title || null,
          scheduleStartsAt: schedule?.startsAt || null,
        })),
      };
      const { result, hasSnapshot } = await invokeSnapshotRpc(client, "save_my_multi_action_worklog_v2", "save_my_multi_action_worklog", input);

      const row = Array.isArray(result) ? result[0] : result;
      const captureId = String(row?.capture_id || "").trim();
      const savedCount = Number(row?.saved_count || 0);
      const workRecordIds = Array.isArray(row?.work_record_ids) ? row.work_record_ids.map(String).filter(Boolean) : [];
      const sourceRefIds = Array.isArray(row?.source_ref_ids) ? row.source_ref_ids.map(String).filter(Boolean) : [];
      const scheduleIds = Array.isArray(row?.schedule_ids) ? row.schedule_ids.map(String).filter(Boolean) : [];
      if (!captureId || savedCount !== records.length || workRecordIds.length !== records.length || sourceRefIds.length !== records.length) {
        throw adapterError("WORKLOG_DATA_CORE_MULTI_RESPONSE_INVALID", "다중 업무 저장 결과가 올바르지 않습니다.");
      }
      const schedules = snapshotsFromRow(row, scheduleIds, hasSnapshot);

      return Object.freeze({
        captureId,
        savedCount,
        workRecordIds: Object.freeze(workRecordIds),
        sourceRefIds: Object.freeze(sourceRefIds),
        scheduleIds: Object.freeze(scheduleIds),
        schedules,
        workRecordId: workRecordIds[0] || "",
        sourceRefId: sourceRefIds[0] || "",
        scheduleId: scheduleIds[0] || "",
        schedule: schedules[0],
        fastPath: true,
        multiAction: true,
      });
    },
    async persistFast(record = {}) {
      if (typeof client?.rpc !== "function") throw adapterError("WORKLOG_DATA_CORE_FAST_RPC_REQUIRED", "Data Core fast save에는 RPC client가 필요합니다.");
      const normalized = normalizedRecord(record);
      const schedule = quickWorklogSchedule(record, normalized);
      const input = {
        p_client_request_id: normalized.clientRequestId,
        p_title: normalized.title,
        p_content: normalized.content,
        p_original_text: normalized.originalText,
        p_record_type: normalized.recordType,
        p_status: normalized.status,
        p_institution: normalized.institution,
        p_amount: normalized.amount,
        p_follow_up: normalized.followUp,
        p_recorded_at: normalized.recordedAt,
        p_due_at: normalized.dueAt,
        p_metadata: normalized.metadata,
        p_source_excerpt: normalized.sourceExcerpt,
        p_schedule_title: schedule?.title || null,
        p_schedule_starts_at: schedule?.startsAt || null,
      };
      const { result, hasSnapshot } = await invokeSnapshotRpc(client, "save_my_worklog_with_schedule_v2", "save_my_worklog_with_schedule", input);
      const row = Array.isArray(result) ? result[0] : result;
      const userId = String(row?.user_id || "").trim();
      const workspaceId = String(row?.workspace_id || "").trim();
      const workRecordId = String(row?.work_record_id || "").trim();
      const sourceRefId = String(row?.source_ref_id || "").trim();
      const scheduleId = String(row?.schedule_id || "").trim();
      if (!workspaceId) throw adapterError("WORKLOG_DATA_CORE_FAST_WORKSPACE_MISSING", "개인 업무공간을 찾지 못했습니다.");
      if (!userId || !workRecordId || !sourceRefId) throw adapterError("WORKLOG_DATA_CORE_FAST_RESPONSE_INVALID", "Data Core fast save 결과가 올바르지 않습니다.");
      if (schedule && !scheduleId) throw adapterError("WORKLOG_DATA_CORE_SCHEDULE_RESPONSE_INVALID", "일정 저장 결과를 확인하지 못했습니다.");
      const schedules = hasSnapshot && scheduleId ? [confirmedSchedule(row, scheduleId)].filter(Boolean) : [];
      return Object.freeze({ userId, workRecordId, sourceRefId, scheduleId, schedule: schedules[0], schedules, workspaceId, fastPath: true });
    },
    async persist(record = {}, workspaceContext) {
      const normalized = normalizedRecord(record);
      const workRecord = await repositories.workRecords.upsertByRequest({
        clientRequestId: normalized.clientRequestId,
        title: normalized.title,
        content: normalized.content,
        originalText: normalized.originalText,
        recordType: normalized.recordType,
        status: normalized.status,
        institution: normalized.institution,
        amount: normalized.amount,
        followUp: normalized.followUp,
        actionKind: normalized.actionKind,
        journalDate: normalized.journalDate,
        recordedAt: normalized.recordedAt,
        dueAt: normalized.dueAt,
        metadata: normalized.metadata,
      }, workspaceContext);
      if (!workRecord?.id) throw adapterError("WORKLOG_DATA_CORE_RECORD_ID_MISSING", "Data Core WorkRecord ID가 없습니다.");
      const sourceRef = await repositories.sourceRefs.upsertByRequest({
        clientRequestId: normalized.clientRequestId,
        entityType: "work_record",
        entityId: String(workRecord.id),
        sourceType: "direct",
        sourceId: normalized.clientRequestId,
        sourceExcerpt: normalized.sourceExcerpt,
        metadata: { source: "quick_worklog", fieldProvenance: { institution: normalized.institutionSource } },
      }, workspaceContext);
      return Object.freeze({ workRecordId: String(workRecord.id), sourceRefId: String(sourceRef?.id || ""), workspaceId: workspaceContext.workspaceId });
    },
  });
}
