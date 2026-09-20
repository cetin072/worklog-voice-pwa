let world = { failCalendar: false, failReminders: false, calls: [] };
const disk = new Map();

export function reset(options = {}) {
  world = { failCalendar: Boolean(options.failCalendar), failReminders: Boolean(options.failReminders), calls: [] };
  disk.clear();
  return world;
}

export async function removeScheduleFromCalendar(scheduleId, startsAt) {
  world.calls.push(['calendar', scheduleId, startsAt]);
  if (world.failCalendar) throw new TypeError('setPrototypeOf argument is not coercible to Object');
  return true;
}
export async function cancelAllScheduleReminders(scheduleId) {
  world.calls.push(['reminders', scheduleId]);
  if (world.failReminders) throw new Error('native reminder failure');
  return 1;
}
export async function listTrackedCalendarScheduleIds() { return []; }
export async function listTrackedReminderScheduleIds() { return []; }

export const secureSessionStorage = {
  async getItem(key) { return disk.get(key) ?? null; },
  async setItem(key, value) { disk.set(key, value); },
  async removeItem(key) { disk.delete(key); },
  async updateItem(key, update) {
    const next = update(disk.get(key) ?? null);
    if (next === null) disk.delete(key); else disk.set(key, next);
    return next;
  },
};
