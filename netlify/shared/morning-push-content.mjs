const MAX_FOCUS_TITLE = 42;
const MAX_BODY_LENGTH = 180;

function count(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function clipTitle(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  return text.length <= MAX_FOCUS_TITLE ? text : `${text.slice(0, MAX_FOCUS_TITLE - 1)}…`;
}

function schedulePrefix(value) {
  const text = String(value ?? "").trim();
  if (text === "종일") return "종일 · ";
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? `${text} ` : "";
}

export function buildMorningPushSummary({ todayCount = 0, overdueCount = 0, scheduleCount = 0 } = {}) {
  const parts = [];
  const today = count(todayCount);
  const overdue = count(overdueCount);
  const schedule = count(scheduleCount);
  if (today) parts.push(`오늘 할 일 ${today}건`);
  if (overdue) parts.push(`지난 업무 ${overdue}건`);
  if (schedule) parts.push(`오늘 일정 ${schedule}건`);
  return parts.join(" · ");
}

export function buildMorningPushBody({
  todayCount = 0,
  overdueCount = 0,
  scheduleCount = 0,
  detailEnabled = true,
  primaryWorkTitle = "",
  primaryWorkBucket = "",
  primaryScheduleTitle = "",
  primaryScheduleTime = "",
} = {}) {
  const summary = buildMorningPushSummary({ todayCount, overdueCount, scheduleCount });
  if (!summary) return "";
  if (detailEnabled === false) return summary;

  const focus = [];
  const scheduleTitle = clipTitle(primaryScheduleTitle);
  if (scheduleTitle) focus.push(`${schedulePrefix(primaryScheduleTime)}${scheduleTitle}`);

  const workTitle = clipTitle(primaryWorkTitle);
  if (workTitle) {
    const label = primaryWorkBucket === "overdue" ? "지난 업무" : "오늘 할 일";
    focus.push(`${label} · ${workTitle}`);
  }

  if (!focus.length) return summary;
  return [...focus.slice(0, 2), summary].join("\n").slice(0, MAX_BODY_LENGTH);
}

export function buildMorningPushPayload(counts = {}) {
  const body = buildMorningPushBody(counts);
  if (!body) return null;
  return Object.freeze({
    title: "업무수첩 · 오늘 브리핑",
    body,
    url: "/#briefingCard",
    tag: "worklog-morning-digest",
  });
}
