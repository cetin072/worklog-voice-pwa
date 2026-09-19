import { briefingCompleteness, BRIEFING_TASK_LIMIT } from "./briefing-completeness.mjs";
const TASK_STATUS_MAP = Object.freeze({ in_progress: "진행중", waiting: "대기", needs_review: "확인필요" });
const SCHEDULE_STATUS_MAP = Object.freeze({ confirmed: "확정", tentative: "임시" });

function sourceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function text(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function seoulDateKey(value) {
  const raw = text(value, 64);
  if (!raw) return "";
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function toBriefingTask(row = {}) {
  return Object.freeze({
    pageId: text(row.id, 200),
    title: text(row.title, 200),
    institution: text(row.institution, 60),
    status: TASK_STATUS_MAP[text(row.status, 80)] || "",
    project: text(row?.metadata?.project, 80),
    dueKey: seoulDateKey(row.due_at),
    followUp: text(row.follow_up, 240),
    editedAt: text(row.updated_at || row.recorded_at, 64),
  });
}

function toBriefingSchedule(row = {}) {
  return Object.freeze({
    scheduleId: text(row.id, 200),
    title: text(row.title, 200),
    startsAt: text(row.starts_at, 64),
    dateKey: seoulDateKey(row.starts_at),
    allDay: Boolean(row.all_day),
    status: SCHEDULE_STATUS_MAP[text(row.status, 40)] || "",
    location: text(row.location, 240),
  });
}

export function createWorklogDataCoreBriefingSource({ client } = {}) {
  if (!client || typeof client.rpc !== "function") {
    throw sourceError("WORKLOG_DATA_CORE_BRIEFING_SOURCE_CLIENT_REQUIRED", "Data Core RPC client가 필요합니다.");
  }

  return Object.freeze({
    async load() {
      const result = await client.rpc("get_my_briefing_source", {});
      const row = Array.isArray(result) ? result[0] : result;
      const workspaceId = text(row?.workspace_id, 200);
      if (!workspaceId) {
        throw sourceError("WORKLOG_DATA_CORE_BRIEFING_WORKSPACE_MISSING", "개인 업무공간을 찾지 못했습니다.");
      }

      const today = text(row?.today, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
        throw sourceError("WORKLOG_DATA_CORE_BRIEFING_TODAY_INVALID", "브리핑 기준일이 올바르지 않습니다.");
      }

      if (!Array.isArray(row?.tasks) || !Array.isArray(row?.schedules)) {
        throw sourceError("WORKLOG_DATA_CORE_BRIEFING_SOURCE_INVALID", "브리핑 데이터 형식을 확인하지 못했습니다.");
      }
      const tasks = row.tasks.slice(0, BRIEFING_TASK_LIMIT)
        .map(toBriefingTask)
        .filter((task) => task.title);
      const scheduleRows = (Array.isArray(row?.schedules) ? row.schedules : [])
        .map(toBriefingSchedule)
        .filter((schedule) => schedule.title && schedule.dateKey);

      const page = await briefingCompleteness({ client, workspaceId, sourceCount: row.tasks.length, displayedCount: tasks.length, rpcBounded: true });
      return Object.freeze({
        ...page,
        workspaceId,
        today,
        tasks: Object.freeze(tasks),
        schedules: Object.freeze({
          today: Object.freeze(scheduleRows.filter((schedule) => schedule.dateKey === today)),
          upcoming: Object.freeze(scheduleRows.filter((schedule) => schedule.dateKey > today)),
          total: scheduleRows.length,
        }),
      });
    },
  });
}
