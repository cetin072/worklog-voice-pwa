import { requireWorkspaceContext } from "./platform/workspace-context.mjs";

const STATUS_MAP = Object.freeze({ in_progress: "진행중", waiting: "대기", needs_review: "확인필요" });

function readerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function text(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function dueDateKey(value) {
  const raw = text(value, 64);
  if (!raw) return "";
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function toBriefingTask(row = {}) {
  return Object.freeze({
    pageId: text(row.id, 200),
    title: text(row.title, 200),
    institution: text(row.institution, 60),
    status: STATUS_MAP[text(row.status, 80)] || "",
    project: text(row?.metadata?.project, 80),
    dueKey: dueDateKey(row.due_at),
    followUp: text(row.follow_up, 240),
    editedAt: text(row.updated_at || row.recorded_at, 64),
  });
}

export function createWorklogDataCoreBriefingReader({ client } = {}) {
  if (!client || typeof client.select !== "function") throw readerError("WORKLOG_DATA_CORE_BRIEFING_CLIENT_REQUIRED", "Data Core select client가 필요합니다.");
  return Object.freeze({
    async listOpenTasks(contextInput) {
      const context = requireWorkspaceContext(contextInput);
      const rows = await client.select("work_records", {
        select: "id,title,institution,status,follow_up,due_at,updated_at,recorded_at,metadata",
        workspace_id: `eq.${context.workspaceId}`,
        status: "in.(in_progress,waiting,needs_review)",
        order: "updated_at.desc",
        limit: "500",
      });
      return Object.freeze(rows.map(toBriefingTask).filter((task) => task.title));
    },
  });
}
