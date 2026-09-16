function count(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

export function buildMorningPushBody({ todayCount = 0, overdueCount = 0, scheduleCount = 0 } = {}) {
  const parts = [];
  const today = count(todayCount);
  const overdue = count(overdueCount);
  const schedule = count(scheduleCount);
  if (today) parts.push(`오늘 할 일 ${today}건`);
  if (overdue) parts.push(`지난 업무 ${overdue}건`);
  if (schedule) parts.push(`오늘 일정 ${schedule}건`);
  return parts.join(" · ");
}

export function buildMorningPushPayload(counts = {}) {
  const body = buildMorningPushBody(counts);
  if (!body) return null;
  return Object.freeze({
    title: "업무수첩 · 아침 브리핑",
    body,
    url: "/",
    tag: "worklog-morning-digest",
  });
}
