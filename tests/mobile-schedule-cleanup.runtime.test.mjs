import assert from 'node:assert/strict';
import { register } from 'node:module';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
const fixture = new URL('./helpers/calendar-native-fake.mjs', import.meta.url).href;
register('./helpers/mobile-ts-loader.mjs', import.meta.url, { data: { mocks: { 'expo-calendar': fixture, 'expo-notifications': fixture, 'expo-crypto': fixture, 'react-native': fixture, '@/src/platform/secure-storage': fixture } } });
const fake = await import(fixture);
const cancellation = await import('../mobile/src/features/schedule/schedule-cancellation.ts');
const calendar = await import('../mobile/src/features/schedule/device-calendar.ts');
const notifications = await import('../mobile/src/features/schedule/local-notifications.ts');
const key = 'worklog.mobile.pending-schedule-cleanup.v1';
const ids = Array.from({ length: 12 }, randomUUID);
const goodClient = { rpc: async () => ({ error: null }) };
test('parallel server-confirmed cancellations cannot overwrite other pending cleanup ids', async () => {
  const w = fake.reset();
  // Failure at an OS boundary, NOT a mocked app function, keeps each cleanup pending.
  w.failure = (kind) => { if (kind === 'list-notifications') throw new Error('OS unavailable'); };
  const results = await Promise.allSettled(ids.map((sid) => cancellation.cancelScheduleWithDeviceCleanup(goodClient, sid)));
  assert.ok(results.every((r) => r.status === 'fulfilled'));
  assert.ok(results.every((r) => r.status === 'fulfilled' && r.value.cleanupPending === true));
  assert.deepEqual(new Set(JSON.parse(await fake.secureSessionStorage.getItem(key))), new Set(ids));
});
test('RPC denial makes no calendar/notification cleanup changes', async () => {
  const w = fake.reset();
  await assert.rejects(cancellation.cancelScheduleWithDeviceCleanup({ rpc: async () => ({ error: { code: '42501', message: 'not allowed' } }) }, ids[0]));
  assert.equal(w.disk.size, 0); assert.equal(w.events.size, 0);
});
test('confirmed cancellation removes actual service-owned calendar and notification mappings', async () => {
  const w = fake.reset(); const sid = ids[0]; const schedule = { scheduleId: sid, title: 'Test', startsAt: '2030-01-01T06:00:00Z' };
  await calendar.syncScheduleToCalendar('work', schedule);
  await notifications.scheduleReminder({ scheduleId: sid, title: 'Test', scheduleStartsAt: schedule.startsAt, offsetMinutes: 30 });
  await cancellation.cancelScheduleWithDeviceCleanup(goodClient, sid);
  assert.equal(w.events.size, 0); assert.equal(w.notifications.size, 0);
  assert.deepEqual(JSON.parse(await fake.secureSessionStorage.getItem(key)), []);
});
test('corrupt cancellation state is not replaced by empty success', async () => {
  fake.reset(); await fake.secureSessionStorage.setItem(key, '{bad');
  await assert.rejects(cancellation.cancelScheduleWithDeviceCleanup(goodClient, ids[0]));
  assert.equal(await fake.secureSessionStorage.getItem(key), '{bad');
});
