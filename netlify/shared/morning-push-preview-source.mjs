const SYSTEM_PROJECTS = new Set(["SYSTEM_DAILY_BRIEFING", "SYSTEM_SPLIT_SOURCE", "SYSTEM_TEST"]);
const OPEN_STATUSES = new Set(["in_progress", "waiting", "needs_review"]);
const SCHEDULE_STATUSES = new Set(["confirmed", "tentative"]);

function text(value, max = 240) {
  return String(value ?? "").trim().slice(0, max);
}

function validDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function seoulDateKey(value) {
  const date = validDate(value);
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function seoulTime(value) {
  const date = validDate(value);
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  const hour = get("hour");
  const minute = get("minute");
  return hour && minute ? `${hour}:${minute}` : "";
}

function systemTask(row) {
  return SYSTEM_PROJECTS.has(text(row?.metadata?.project, 80));
}

function taskSort(a, b, today) {
  const aKey = seoulDateKey(a?.due_at);
  const bKey = seoulDateKey(b?.due_at);
  const aBucket = aKey && aKey < today ? 0 : 1;
  const bBucket = bKey && bKey < today ? 0 : 1;
  if (aBucket !== bBucket) return aBucket - bBucket;
  const aDue = validDate(a?.due_at)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const bDue = validDate(b?.due_at)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (aDue !== bDue) return aDue - bDue;
  const aUpdated = validDate(a?.updated_at)?.getTime() ?? 0;
  const bUpdated = validDate(b?.updated_at)?.getTime() ?? 0;
  return bUpdated - aUpdated;
}

export function buildMorningPushPreviewState(sourceRow = {}, { detailEnabled = true } = {}) {
  const today = text(sourceRow?.today, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    const error = new Error("아침 알림 기준일이 올바르지 않습니다.");
    error.code = "MORNING_PUSH_PREVIEW_TODAY_INVALID";
    throw error;
  }

  const tasks = (Array.isArray(sourceRow?.tasks) ? sourceRow.tasks : [])
    .filter((row) => OPEN_STATUSES.has(text(row?.status, 40)))
    .filter((row) => !systemTask(row));

  const dueTasks = tasks
    .map((row) => ({ row, dueKey: seoulDateKey(row?.due_at) }))
    .filter((entry) => entry.dueKey && entry.dueKey <= today);

  const todayTasks = dueTasks.filter((entry) => entry.dueKey === today);
  const overdueTasks = dueTasks.filter((entry) => entry.dueKey < today);
  const primaryWork = dueTasks.map((entry) => entry.row).sort((a, b) => taskSort(a, b, today))[0] || null;
  const primaryWorkDueKey = primaryWork ? seoulDateKey(primaryWork.due_at) : "";

  const schedules = (Array.isArray(sourceRow?.schedules) ? sourceRow.schedules : [])
    .filter((row) => SCHEDULE_STATUSES.has(text(row?.status, 40)))
    .filter((row) => seoulDateKey(row?.starts_at) === today)
    .sort((a, b) => (validDate(a?.starts_at)?.getTime() ?? Number.MAX_SAFE_INTEGER) - (validDate(b?.starts_at)?.getTime() ?? Number.MAX_SAFE_INTEGER));
  const primarySchedule = schedules[0] || null;

  return Object.freeze({
    todayCount: todayTasks.length,
    overdueCount: overdueTasks.length,
    scheduleCount: schedules.length,
    detailEnabled: detailEnabled !== false,
    primaryWorkTitle: text(primaryWork?.title, 200),
    primaryWorkBucket: primaryWorkDueKey && primaryWorkDueKey < today ? "overdue" : primaryWork ? "today" : "",
    primaryScheduleTitle: text(primarySchedule?.title, 200),
    primaryScheduleTime: primarySchedule ? (primarySchedule.all_day ? "종일" : seoulTime(primarySchedule.starts_at)) : "",
  });
}
