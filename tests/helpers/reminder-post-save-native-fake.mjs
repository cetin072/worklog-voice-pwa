export const calls = [];
let tracked = [];
export function reset(ids = []) { calls.length = 0; tracked = ids; }
export async function listTrackedReminderScheduleIds() { calls.push('tracked'); return [...tracked]; }
export async function synchronizeScheduleReminders(input) { calls.push(['move', input.scheduleId]); return { failed: 0 }; }
export async function scheduleReminder(input) { calls.push(['schedule', input.scheduleId]); }
export async function cancelAllScheduleReminders(id) { calls.push(['cancel', id]); }
export async function reconcileScheduleReminders() { calls.push('native-recovery'); tracked = []; return { failed: 0 }; }
const disk = new Map();
export const secureSessionStorage = {
  async getItem(key) { return disk.get(key) ?? null; },
  async updateItem(key, fn) { const value = fn(disk.get(key) ?? null); disk.set(key, value); return value; },
};
