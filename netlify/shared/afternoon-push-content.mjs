const MAX_FOCUS_TITLE = 42;
const MAX_BODY_LENGTH = 160;

function count(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function clipTitle(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  return text.length <= MAX_FOCUS_TITLE ? text : `${text.slice(0, MAX_FOCUS_TITLE - 1)}…`;
}

export function buildAfternoonPushSummary({ todayCount = 0, overdueCount = 0 } = {}) {
  const parts = [];
  const today = count(todayCount);
  const overdue = count(overdueCount);
  if (today) parts.push(`오늘 할 일 ${today}건`);
  if (overdue) parts.push(`지난 업무 ${overdue}건`);
  return parts.join(" · ");
}

export function buildAfternoonPushBody({
  todayCount = 0,
  overdueCount = 0,
  detailEnabled = true,
  primaryWorkTitle = "",
  primaryWorkBucket = "",
} = {}) {
  const summary = buildAfternoonPushSummary({ todayCount, overdueCount });
  if (!summary) return "";
  if (detailEnabled === false) return summary;

  const title = clipTitle(primaryWorkTitle);
  if (!title) return summary;
  const label = primaryWorkBucket === "overdue" ? "지난 업무" : "오늘 할 일";
  return `${label} · ${title}\n${summary}`.slice(0, MAX_BODY_LENGTH);
}

export function buildAfternoonPushPayload(counts = {}) {
  const body = buildAfternoonPushBody(counts);
  if (!body) return null;
  return Object.freeze({
    title: "업무수첩 · 오후 업무 확인",
    body,
    url: "/#briefingCard",
    tag: "worklog-afternoon-incomplete",
  });
}
