import assert from 'node:assert/strict';
import { register } from 'node:module';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const fixture = new URL('./helpers/schedule-cancellation-native-fake.mjs', import.meta.url).href;
register('./helpers/mobile-ts-loader.mjs', import.meta.url, { data: { mocks: {
  './local-notifications': fixture,
  '@/src/platform/secure-storage': fixture,
} } });
const fake = await import(fixture);
const cancellation = await import('../mobile/src/features/schedule/schedule-cancellation.ts');
const key = 'worklog.mobile.pending-schedule-cleanup.v1';
const ids = Array.from({ length: 12 }, randomUUID);
const goodClient = { rpc: async () => ({ data: [{ schedule_status: 'cancelled', already_cancelled: false }], error: null }) };

test('parallel server-confirmed cancellations cannot overwrite other pending cleanup ids', async () => {
  const w = fake.reset({ failReminders: true });
  const results = await Promise.allSettled(ids.map((sid) => cancellation.cancelScheduleWithDeviceCleanup(goodClient, sid)));
  assert.ok(results.every((r) => r.status === 'fulfilled'));
  assert.ok(results.every((r) => r.status === 'fulfilled' && r.value.cleanupPending === true));
  assert.deepEqual(new Set(JSON.parse(await fake.secureSessionStorage.getItem(key))), new Set(ids));
  assert.ok(w.calls.every((call) => call[0] === 'reminders'));
});

test('RPC denial makes no local reminder cleanup changes', async () => {
  const w = fake.reset();
  await assert.rejects(cancellation.cancelScheduleWithDeviceCleanup({ rpc: async () => ({ error: { code: '42501', message: 'not allowed' } }) }, ids[0]));
  assert.equal(w.calls.length, 0);
});

test('confirmed cancellation removes local reminder cleanup marker after reminder cleanup', async () => {
  const w = fake.reset();
  const sid = ids[0];
  await cancellation.cancelScheduleWithDeviceCleanup(goodClient, sid);
  assert.deepEqual(w.calls, [['reminders', sid]]);
  assert.deepEqual(JSON.parse(await fake.secureSessionStorage.getItem(key)), []);
});

test('corrupt cancellation state is not replaced by empty success', async () => {
  fake.reset();
  await fake.secureSessionStorage.setItem(key, '{bad');
  await assert.rejects(cancellation.cancelScheduleWithDeviceCleanup(goodClient, ids[0]));
  assert.equal(await fake.secureSessionStorage.getItem(key), '{bad');
});
