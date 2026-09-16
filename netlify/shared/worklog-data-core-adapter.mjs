import { createDataCoreRepositories } from "./data-core/repositories.mjs";

const TYPE_MAP = Object.freeze({ "완료업무": "completed_work", "할 일": "task", "회의·통화": "meeting_call", "지출·세무": "expense_tax", "지시·위임": "delegation", "아이디어": "idea", "문제·확인": "issue_review", "기타": "other" });
const STATUS_MAP = Object.freeze({ "완료": "completed", "진행중": "in_progress", "대기": "waiting", "확인필요": "needs_review" });
const EVENT_SIGNAL_RE = /(미팅|약속|면담|상담|방문|만나|통화|전화(?!번호)|인터뷰|행사|교육|세미나|촬영|식사|점심|저녁|출발|도착|회의(?!\s*(?:자료|록|안건|준비|내용)))/;
const STRONG_EVENT_VERB_RE = /(약속|면담|상담|방문|만나|통화|전화(?!번호)|출발|도착)/;
const DEADLINE_RE = /까지[\s\S]{0,40}(?:제출|보내|전달|완료|처리|보고|정리|준비|확인)|(?:마감|제출기한|완료기한)/;

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
function hasExplicitTime(value) {
  return /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(String(value || ""));
}

export function quickWorklogSchedule(record = {}, normalized = {}) {
  if (!hasExplicitTime(record.dueStart)) return null;
  const source = String(record.transcript || "").replace(/\s+/g, " ").trim();
  if (!source) return null;
  const deadline = DEADLINE_RE.test(source);
  const strongEvent = STRONG_EVENT_VERB_RE.test(source);
  const eventSignal = EVENT_SIGNAL_RE.test(source);
  const meetingType = normalized.recordType === "meeting_call";
  if (deadline && !strongEvent) return null;
  if (!eventSignal && !meetingType) return null;
  return Object.freeze({
    title: normalized.title,
    startsAt: normalized.dueAt,
    timezone: "Asia/Seoul",
    status: "confirmed",
  });
}

function normalizedRecord(record = {}) {
  const clientRequestId = String(record.clientRequestId || "").trim();
  if (!/^[A-Za-z0-9-]{16,100}$/.test(clientRequestId)) throw adapterError("WORKLOG_DATA_CORE_REQUEST_ID_REQUIRED", "Data Core 저장에는 유효한 clientRequestId가 필요합니다.");
  return Object.freeze({
    clientRequestId,
    title: title(record.cleanTranscript),
    content: String(record.cleanTranscript || ""),
    originalText: String(record.transcript || ""),
    recordType: TYPE_MAP[record.type] || "other",
    status: STATUS_MAP[record.status] || "in_progress",
    institution: String(record.institution || "").trim() || null,
    amount: amount(record.amount),
    followUp: String(record.followUp || "").trim() || null,
    recordedAt: validRecordedAt(record.recordedAt),
    dueAt: dueAt(record.dueStart),
    metadata: { source: "quick_worklog", clientRequestId },
    sourceExcerpt: String(record.transcript || ""),
  });
}

export function createWorklogDataCoreAdapter({ client } = {}) {
  const repositories = createDataCoreRepositories(client);
  return Object.freeze({
    async persistFast(record = {}) {
      if (typeof client?.rpc !== "function") throw adapterError("WORKLOG_DATA_CORE_FAST_RPC_REQUIRED", "Data Core fast save에는 RPC client가 필요합니다.");
      const normalized = normalizedRecord(record);
      const schedule = quickWorklogSchedule(record, normalized);
      const result = await client.rpc("save_my_worklog_with_schedule", {
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
      });
      const row = Array.isArray(result) ? result[0] : result;
      const userId = String(row?.user_id || "").trim();
      const workspaceId = String(row?.workspace_id || "").trim();
      const workRecordId = String(row?.work_record_id || "").trim();
      const sourceRefId = String(row?.source_ref_id || "").trim();
      const scheduleId = String(row?.schedule_id || "").trim();
      if (!workspaceId) throw adapterError("WORKLOG_DATA_CORE_FAST_WORKSPACE_MISSING", "개인 업무공간을 찾지 못했습니다.");
      if (!userId || !workRecordId || !sourceRefId) throw adapterError("WORKLOG_DATA_CORE_FAST_RESPONSE_INVALID", "Data Core fast save 결과가 올바르지 않습니다.");
      if (schedule && !scheduleId) throw adapterError("WORKLOG_DATA_CORE_SCHEDULE_RESPONSE_INVALID", "일정 저장 결과를 확인하지 못했습니다.");
      return Object.freeze({ userId, workRecordId, sourceRefId, scheduleId, workspaceId, fastPath: true });
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
        metadata: { source: "quick_worklog" },
      }, workspaceContext);
      return Object.freeze({ workRecordId: String(workRecord.id), sourceRefId: String(sourceRef?.id || ""), workspaceId: workspaceContext.workspaceId });
    },
  });
}