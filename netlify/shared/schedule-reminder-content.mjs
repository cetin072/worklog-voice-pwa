export function buildScheduleReminderPayload(schedule = {}) {
  const title = String(schedule.title || '').trim().slice(0, 160);
  if (!title) return null;
  return Object.freeze({
    title: '업무수첩 · 30분 뒤 일정',
    body: title,
    tag: `worklog-schedule-reminder-${String(schedule.scheduleId || schedule.id || '').slice(0,80)}`,
    url: '/#briefingCard',
    data: Object.freeze({ kind: 'schedule_advance', scheduleId: String(schedule.scheduleId || schedule.id || '') }),
  });
}
