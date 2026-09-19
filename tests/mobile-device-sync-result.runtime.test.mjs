import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { collectDeviceSyncResult } = await import('../mobile/src/features/schedule/device-sync-result.ts');
test('resolved failed-count is not silently treated as successful reminder sync', async () => {
  const r = await collectDeviceSyncResult({ reminders: async () => ({ failed: 2 }), calendar: async () => ({ updated: true, reason: 'synced' }) });
  assert.equal(r.reminders.status, 'error'); assert.match(r.reminders.message, /2개/); assert.equal(r.calendar.status, 'synced');
});
test('calendar exception does not hide a successful reminder result', async () => {
  const r = await collectDeviceSyncResult({ reminders: async () => ({ failed: 0 }), calendar: async () => { throw new Error('Calendar locked'); } });
  assert.equal(r.calendar.status, 'error'); assert.equal(r.reminders.status, 'synced');
});
test('permissions, disconnected and invalid input are not claimed synced', async () => {
  for (const [reason, expected] of [['permission', 'permission'], ['not-connected', 'not-connected'], ['invalid-schedule', 'error']]) {
    const r = await collectDeviceSyncResult({ reminders: async () => ({ failed: 0 }), calendar: async () => ({ updated: false, reason }) }); assert.equal(r.calendar.status, expected);
  }
});
test('synchronous exceptions remain independent and never escape as fake success', async () => {
  let calendarCalled = false;
  const r = await collectDeviceSyncResult({ reminders() { throw new Error('storage broken'); }, calendar: async () => { calendarCalled = true; return { updated: true, reason: 'synced' }; } });
  assert.equal(r.reminders.status, 'error'); assert.equal(calendarCalled, true);
});
