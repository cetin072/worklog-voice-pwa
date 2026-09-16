import { requireWorkspaceContext } from "./platform/workspace-context.mjs";

function editError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function recordId(value) {
  const id = String(value || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw editError("WORKLOG_DATA_CORE_EDIT_RECORD_ID_INVALID", "수정할 업무 식별자가 올바르지 않습니다.");
  }
  return id;
}

function title(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) throw editError("WORKLOG_DATA_CORE_EDIT_TITLE_INVALID", "업무명을 입력해주세요.");
  if (normalized.length > 160) throw editError("WORKLOG_DATA_CORE_EDIT_TITLE_INVALID", "업무명은 160자 이하로 입력해주세요.");
  return normalized;
}

export function createWorklogDataCoreTitleEditor({ client } = {}) {
  if (!client || typeof client.update !== "function") {
    throw editError("WORKLOG_DATA_CORE_EDIT_CLIENT_REQUIRED", "Data Core update client가 필요합니다.");
  }

  return Object.freeze({
    async updateTitle({ recordId: rawRecordId, title: rawTitle } = {}, contextInput) {
      const context = requireWorkspaceContext(contextInput);
      const id = recordId(rawRecordId);
      const nextTitle = title(rawTitle);
      const rows = await client.update("work_records", { title: nextTitle }, {
        id: `eq.${id}`,
        workspace_id: `eq.${context.workspaceId}`,
        creator_user_id: `eq.${context.userId}`,
      });
      if (!Array.isArray(rows) || rows.length !== 1) {
        throw editError("WORKLOG_DATA_CORE_EDIT_NOT_FOUND_OR_FORBIDDEN", "수정할 업무를 찾지 못했거나 수정 권한이 없습니다.");
      }
      const row = rows[0] || {};
      return Object.freeze({ recordId: id, title: String(row.title || nextTitle) });
    },
  });
}
