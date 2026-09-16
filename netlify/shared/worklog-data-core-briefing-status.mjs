import { requireWorkspaceContext } from "./platform/workspace-context.mjs";

const STATUS_MAP = Object.freeze({ "완료": "completed", "진행중": "in_progress", "대기": "waiting", "확인필요": "needs_review" });
const REVERSE_STATUS_MAP = Object.freeze(Object.fromEntries(Object.entries(STATUS_MAP).map(([label, value]) => [value, label])));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function statusError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeStatusInput({ recordId, status } = {}) {
  const id = String(recordId || "").trim();
  if (!UUID_RE.test(id)) throw statusError("WORKLOG_DATA_CORE_STATUS_RECORD_ID_INVALID", "WorkRecord ID가 올바르지 않습니다.");
  const internalStatus = STATUS_MAP[String(status || "").trim()];
  if (!internalStatus) throw statusError("WORKLOG_DATA_CORE_STATUS_INVALID", "변경할 업무 상태가 올바르지 않습니다.");
  return Object.freeze({ id, internalStatus });
}

export function createWorklogDataCoreBriefingStatus({ client } = {}) {
  if (!client || typeof client.update !== "function") throw statusError("WORKLOG_DATA_CORE_STATUS_CLIENT_REQUIRED", "Data Core update client가 필요합니다.");
  return Object.freeze({
    async updateStatusFast(input = {}) {
      if (typeof client.rpc !== "function") throw statusError("WORKLOG_DATA_CORE_STATUS_FAST_RPC_REQUIRED", "Data Core fast status에는 RPC client가 필요합니다.");
      const { id, internalStatus } = normalizeStatusInput(input);
      const result = await client.rpc("update_my_work_record_status", { p_record_id: id, p_status: internalStatus });
      const row = Array.isArray(result) ? result[0] : result;
      if (!row || String(row.record_id || "") !== id) {
        throw statusError("WORKLOG_DATA_CORE_STATUS_NOT_FOUND_OR_FORBIDDEN", "변경할 업무를 찾지 못했거나 권한이 없습니다.");
      }
      return Object.freeze({ recordId: id, status: REVERSE_STATUS_MAP[String(row.status_value || internalStatus)] || input.status });
    },
    async updateStatus(input = {}, contextInput) {
      const context = requireWorkspaceContext(contextInput);
      const { id, internalStatus } = normalizeStatusInput(input);
      const rows = await client.update("work_records", { status: internalStatus }, {
        id: `eq.${id}`,
        workspace_id: `eq.${context.workspaceId}`,
        created_by_user_id: `eq.${context.userId}`,
      });
      if (rows.length !== 1 || String(rows[0]?.id || "") !== id) throw statusError("WORKLOG_DATA_CORE_STATUS_NOT_FOUND_OR_FORBIDDEN", "변경할 업무를 찾지 못했거나 권한이 없습니다.");
      return Object.freeze({ recordId: id, status: REVERSE_STATUS_MAP[String(rows[0]?.status || internalStatus)] || input.status });
    },
  });
}
