import { createDataCoreRepositories } from "./data-core/repositories.mjs";

const TYPE_MAP = Object.freeze({ "완료업무": "completed_work", "할 일": "task", "회의·통화": "meeting_call", "지출·세무": "expense_tax", "지시·위임": "delegation", "아이디어": "idea", "문제·확인": "issue_review", "기타": "other" });
const STATUS_MAP = Object.freeze({ "완료": "completed", "진행중": "in_progress", "대기": "waiting", "확인필요": "needs_review" });

function adapterError(code, message, details = {}) { const error = new Error(message); error.code = code; Object.assign(error, details); return error; }
function validRecordedAt(value) { const date = new Date(value || ""); return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString(); }
function title(value) { const text = String(value || "").replace(/\s+/g, " ").trim(); return text.length <= 200 ? text : text.slice(0, 200); }
function dueAt(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? `${value}T00:00:00+09:00` : null; }

export function createWorklogDataCoreAdapter({ client } = {}) {
  const repositories = createDataCoreRepositories(client);
  return Object.freeze({
    async persist(record = {}, workspaceContext) {
      const clientRequestId = String(record.clientRequestId || "").trim();
      if (!/^[A-Za-z0-9-]{16,100}$/.test(clientRequestId)) throw adapterError("WORKLOG_DATA_CORE_REQUEST_ID_REQUIRED", "Data Core 저장에는 유효한 clientRequestId가 필요합니다.");
      const workRecord = await repositories.workRecords.upsertByRequest({
        clientRequestId, title: title(record.cleanTranscript), content: record.cleanTranscript, originalText: record.transcript,
        recordType: TYPE_MAP[record.type] || "other", status: STATUS_MAP[record.status] || "in_progress", institution: record.institution,
        amount: record.amount, followUp: record.followUp, recordedAt: validRecordedAt(record.recordedAt), dueAt: dueAt(record.dueStart),
        metadata: { source: "quick_worklog", clientRequestId },
      }, workspaceContext);
      if (!workRecord?.id) throw adapterError("WORKLOG_DATA_CORE_RECORD_ID_MISSING", "Data Core WorkRecord ID가 없습니다.");
      const sourceRef = await repositories.sourceRefs.upsertByRequest({
        clientRequestId, entityType: "work_record", entityId: String(workRecord.id), sourceType: "direct", sourceId: clientRequestId,
        sourceExcerpt: record.transcript, metadata: { source: "quick_worklog" },
      }, workspaceContext);
      return Object.freeze({ workRecordId: String(workRecord.id), sourceRefId: String(sourceRef?.id || ""), workspaceId: workspaceContext.workspaceId });
    },
  });
}
