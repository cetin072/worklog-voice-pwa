import { requireWorkspaceContext } from "./platform/workspace-context.mjs";

const STATUS_MAP = Object.freeze({ confirmed: "확정", tentative: "임시" });

function readerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function text(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function dateKey(value) {
  const raw = text(value, 64);
  if (!raw) return "";
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(key, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return "";
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function toBriefingSchedule(row = {}) {
  return Object.freeze({
    scheduleId: text(row.id, 200),
    title: text(row.title, 200),
    startsAt: text(row.starts_at, 64),
    dateKey: dateKey(row.starts_at),
    allDay: Boolean(row.all_day),
    status: STATUS_MAP[text(row.status, 40)] || "",
    location: text(row.location, 240),
  });
}

export function createWorklogDataCoreScheduleReader({ client } = {}) {
  if (!client || typeof client.select !== "function") throw readerError("WORKLOG_DATA_CORE_SCHEDULE_CLIENT_REQUIRED", "Data Core schedule select client가 필요합니다.");
  return Object.freeze({
    async listForBriefing(contextInput, today) {
      const context = requireWorkspaceContext(contextInput);
      const todayKey = String(today || "").trim();
      const endExclusive = addDays(todayKey, 15);
      if (!endExclusive) throw readerError("WORKLOG_DATA_CORE_SCHEDULE_TODAY_INVALID", "브리핑 기준일이 올바르지 않습니다.");
      const rows = await client.select("schedules", {
        select: "id,title,starts_at,all_day,status,location",
        workspace_id: `eq.${context.workspaceId}`,
        status: "in.(confirmed,tentative)",
        starts_at: `gte.${todayKey}T00:00:00+09:00`,
        and: `(starts_at.lt.${endExclusive}T00:00:00+09:00)`,
        order: "starts_at.asc",
        limit: "100",
      });
      const schedules = rows
        .map(toBriefingSchedule)
        .filter((schedule) => schedule.title && schedule.dateKey >= todayKey && schedule.dateKey < endExclusive);
      return Object.freeze({
        today: Object.freeze(schedules.filter((schedule) => schedule.dateKey === todayKey)),
        upcoming: Object.freeze(schedules.filter((schedule) => schedule.dateKey > todayKey)),
        total: schedules.length,
      });
    },
  });
}
