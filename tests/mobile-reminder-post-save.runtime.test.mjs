import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
const fixture = new URL('./helpers/reminder-post-save-native-fake.mjs', import.meta.url).href;
register('./helpers/mobile-ts-loader.mjs', import.meta.url, { data: { mocks: { './local-notifications': fixture, '@/src/features/schedule/local-notifications': fixture, '@/src/platform/secure-storage': fixture } } });
const fake = await import(fixture);
const post = await import('../mobile/src/features/schedule/schedule-reminder-post-save.ts');
const { reminderSessionEpoch } = await import('../mobile/src/features/schedule/schedule-reminder-snapshot.ts');
const SID = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const schedule = { id: SID, title: 'test', startsAt: '2099-01-01T10:00:00Z', status: 'confirmed' };

for (const kind of ['save', 'edit', 'delete']) test(`late ${kind} response from previous session never changes native reminders`, async () => {
  fake.reset(); const guard = reminderSessionEpoch.capture(); reminderSessionEpoch.invalidate();
  const action = kind === 'save' ? () => post.synchronizeSavedScheduleReminders({ schedule }, guard)
    : kind === 'edit' ? () => post.synchronizeUpdatedScheduleReminder(schedule, guard)
    : () => post.cancelSavedScheduleReminders([SID], guard);
  await assert.rejects(async () => action(), /STALE/);
  assert.deepEqual(fake.calls, []);
});

function clientFor(rows, error = null) {
  return {
    auth: { async getUser() { return { data: { user: { id: USER } }, error: null }; } },
    from() { return { select() { return { in(_field, ids) { fake.calls.push(['query', ids]); return { async eq() { return { data: rows, count: rows.length, error }; } }; } }; } }; },
  };
}

test('startup reads a tracked schedule before native expiry cleanup can lose an out-of-window time edit', async () => {
  fake.reset([SID]);
  const client = clientFor([{ id: SID, created_by_user_id: USER, title: 'test', starts_at: schedule.startsAt, status: 'confirmed', all_day: false, updated_at: '2030-01-01T00:00:00Z' }]);
  await post.recoverSavedScheduleReminders(client);
  const query = fake.calls.findIndex(c => Array.isArray(c) && c[0] === 'query');
  const moved = fake.calls.findIndex(c => Array.isArray(c) && c[0] === 'move');
  const native = fake.calls.indexOf('native-recovery');
  assert.ok(query >= 0 && moved > query);
  assert.equal(native, -1);
  assert.deepEqual(fake.calls[query][1], [SID]);
});

test('failed or unresolved canonical lookup does not run native expiry cleanup', async () => {
  for (const error of [null, { message: 'offline' }]) {
    fake.reset([SID]);
    if (error) await assert.rejects(post.recoverSavedScheduleReminders(clientFor([], error)), /UNAVAILABLE/);
    else assert.equal((await post.recoverSavedScheduleReminders(clientFor([]))).unresolved, 1);
    assert.equal(fake.calls.includes('native-recovery'), false);
    assert.equal(fake.calls.some(c => Array.isArray(c) && ['cancel', 'move', 'schedule'].includes(c[0])), false);
  }
});

for (const offset of [0,30,1440]) test(`manual preset ${offset} reconciles all offsets and start before selected reservation`,async()=>{
 fake.reset(); await post.reserveConfirmedReminder(schedule,offset,()=>true);
 assert.deepEqual(fake.calls,[['move',SID],['schedule',SID,0],...(offset ? [['schedule',SID,offset]] : [])]);
});
test('past or cancelled manual selection never mutates device state',async()=>{
 fake.reset();
 await assert.rejects(post.reserveConfirmedReminder({...schedule,startsAt:'2000-01-01T00:00:00Z'},30,()=>true),/TIME/);
 await assert.rejects(post.reserveConfirmedReminder({...schedule,status:'cancelled'},0,()=>true),/INACTIVE/);
 assert.deepEqual(fake.calls,[]);
});
