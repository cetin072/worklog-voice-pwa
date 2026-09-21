import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

const fixture = new URL('./helpers/schedule-cancellation-native-fake.mjs', import.meta.url).href;
register('./helpers/mobile-ts-loader.mjs', import.meta.url, { data: { mocks: {
  './local-notifications': fixture,
  '@/src/platform/secure-storage': fixture,
} } });
const fake = await import(fixture);
const cancellation = await import('../mobile/src/features/schedule/schedule-cancellation.ts');

const scheduleId = '6d274a46-2e24-4b12-a961-d78fec6097d8';
const startsAt = '2026-09-20T02:00:00Z';

function rpcClient(row) {
  return {
    rpc: async () => ({ data: [row], error: null }),
  };
}

test('already-cancelled server state is a successful idempotent cancellation and still converges device cleanup', async () => {
  const world = fake.reset();
  const result = await cancellation.cancelScheduleWithDeviceCleanup(
    rpcClient({ schedule_id: scheduleId, schedule_status: 'cancelled', already_cancelled: true }),
    scheduleId,
    startsAt,
  );
  assert.equal(result.scheduleId, scheduleId);
  assert.equal(result.alreadyCancelled, true);
  assert.equal(result.cleanupPending, false);
  assert.deepEqual(world.calls, [
    ['reminders', scheduleId],
  ]);
});

test('server cancellation remains successful when native cleanup fails and leaves recovery pending', async () => {
  fake.reset({ failReminders: true });
  const result = await cancellation.cancelScheduleWithDeviceCleanup(
    rpcClient({ schedule_id: scheduleId, schedule_status: 'cancelled', already_cancelled: false }),
    scheduleId,
    startsAt,
  );
  assert.equal(result.scheduleId, scheduleId);
  assert.equal(result.alreadyCancelled, false);
  assert.equal(result.cleanupPending, true);
});
