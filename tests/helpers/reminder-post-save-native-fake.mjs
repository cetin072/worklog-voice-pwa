export const calls = [];
let tracked = [];
export function reset(ids = []) { calls.length = 0; tracked = ids; confirmationError = null; }
export async function listTrackedReminderScheduleIds() { calls.push('tracked'); return [...tracked]; }
export async function synchronizeScheduleReminders(input) { calls.push(['move', input.scheduleId]); return { failed: 0 }; }
export async function scheduleReminder(input) { calls.push(['schedule', input.scheduleId, input.offsetMinutes]); }
export async function cancelAllScheduleReminders(id) { calls.push(['cancel', id]); }
export async function reconcileScheduleReminders() { calls.push('native-recovery'); tracked = []; return { failed: 0 }; }
const disk = new Map();
export const secureSessionStorage = {
  async getItem(key) { return disk.get(key) ?? null; },
  async updateItem(key, fn) { const value = fn(disk.get(key) ?? null); disk.set(key, value); return value; },
};

export let confirmationError = null;
export function setConfirmationError(error) { confirmationError = error; }
export async function confirmWorklogReminder(_client, recordId, startsAt, current) {
  if (!current()) throw new Error('STALE');
  calls.push(['confirm', recordId, startsAt]);
  if (confirmationError) throw confirmationError;
  return { id: '11111111-1111-4111-8111-111111111111', title: 'test', startsAt, status: 'confirmed' };
}
