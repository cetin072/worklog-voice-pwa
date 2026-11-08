import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
const fixture = new URL('./helpers/reminder-post-save-native-fake.mjs', import.meta.url).href;
register('./helpers/mobile-ts-loader.mjs', import.meta.url, { data: { mocks: { './local-notifications': fixture, '@/src/features/schedule/local-notifications': fixture, '@/src/platform/secure-storage': fixture, './worklog-reminder-adapter': fixture } } });
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


test('legacy save ID without snapshot reads only owner-verified canonical Schedule before native alarm', async () => {
  fake.reset();
  const row = {
    id: SID, created_by_user_id: USER, title: '검수용 일정',
    starts_at: '2099-01-01T10:00:00Z', status: 'confirmed', all_day: false,
    updated_at: '2030-01-01T00:00:00Z',
  };
  const result = await post.synchronizeSavedScheduleReminders(
    { scheduleId: SID }, () => true, clientFor([row]),
  );
  assert.deepEqual(result, [{ action: 'scheduled', scheduleId: SID }]);
  assert.deepEqual(fake.calls, [['query', [SID]], ['move', SID], ['schedule', SID, 0]]);
});

test('complete canonical save receipt skips extra lookup and still schedules once', async () => {
  fake.reset();
  const client = { auth: { getUser() { throw Error('unneeded auth read'); } } };
  const result = await post.synchronizeSavedScheduleReminders(
    { scheduleId: SID, schedule }, () => true, client,
  );
  assert.deepEqual(result, [{ action: 'scheduled', scheduleId: SID }]);
  assert.deepEqual(fake.calls, [['move', SID], ['schedule', SID, 0]]);
});

test('partial snapshot from old compatible RPC is repaired from read-only canonical Schedule', async () => {
  fake.reset();
  const row = {
    id: SID, created_by_user_id: USER, title: '복구한 제목',
    starts_at: schedule.startsAt, status: 'confirmed', all_day: false,
    updated_at: '2030-01-01T00:00:00Z',
  };
  const result = await post.synchronizeSavedScheduleReminders(
    { scheduleId: SID, schedule: { id: SID, status: 'confirmed' } },
    () => true, clientFor([row]),
  );
  assert.deepEqual(result, [{ action: 'scheduled', scheduleId: SID }]);
  assert.deepEqual(fake.calls, [['query', [SID]], ['move', SID], ['schedule', SID, 0]]);
});

test('missing or cross-account Schedule refuses native mutation after saved WorkRecord', async () => {
  const other = {
    id: SID, created_by_user_id: '33333333-3333-4333-8333-333333333333',
    title: '다른 사람 기록', starts_at: schedule.startsAt, status: 'confirmed',
    all_day: false, updated_at: '2030-01-01T00:00:00Z',
  };
  for (const rows of [[], [other]]) {
    fake.reset();
    await assert.rejects(
      post.synchronizeSavedScheduleReminders({ scheduleId: SID }, () => true, clientFor(rows)),
      /INCOMPLETE_REMINDER_SNAPSHOT|INVALID_REMINDER_SNAPSHOT/,
    );
    assert.deepEqual(fake.calls, [['query', [SID]]], 'no OS schedule or cancellation on unverified receipt');
  }
});

test('failed, stale or missing authenticated snapshot cannot create a false scheduled state', async () => {
  fake.reset();
  const row = {
    id: SID, created_by_user_id: USER, title: 'test',
    starts_at: schedule.startsAt, status: 'confirmed', all_day: false,
    updated_at: '2030-01-01T00:00:00Z',
  };
  await assert.rejects(
    post.synchronizeSavedScheduleReminders({ scheduleId: SID }, () => true,
      clientFor([row], { message: 'network read failed' })),
    /REMINDER_SNAPSHOT_UNAVAILABLE/,
  );
  assert.deepEqual(fake.calls, [['query', [SID]]]);

  fake.reset();
  let reads = 0;
  const changedOwner = clientFor([row]);
  changedOwner.auth.getUser = async () => ({
    data: { user: { id: ++reads > 1 ? '33333333-3333-4333-8333-333333333333' : USER } },
    error: null,
  });
  await assert.rejects(
    post.synchronizeSavedScheduleReminders({ scheduleId: SID }, () => true, changedOwner),
    /REMINDER_OWNER_CHANGED/,
  );
  assert.deepEqual(fake.calls, [['query', [SID]]]);

  fake.reset();
  assert.deepEqual(
    await post.synchronizeSavedScheduleReminders({ scheduleId: SID }, () => true),
    [],
    'without owner-verified reader the result remains unconfirmed',
  );
  assert.deepEqual(fake.calls, []);
});

test('receipt IDs are deduplicated; no second server read for already complete schedules', async () => {
  fake.reset();
  const second = '44444444-4444-4444-8444-444444444444';
  const row = {
    id: second, created_by_user_id: USER, title: '두 번째 일정',
    starts_at: '2099-01-02T10:00:00Z', status: 'confirmed',
    all_day: false, updated_at: '2030-01-01T00:00:00Z',
  };
  const result = await post.synchronizeSavedScheduleReminders(
    { scheduleIds: [SID, second, SID], scheduleId: SID, schedules: [schedule] },
    () => true, clientFor([row]),
  );
  assert.deepEqual(result, [
    { action: 'scheduled', scheduleId: SID },
    { action: 'scheduled', scheduleId: second },
  ]);
  assert.deepEqual(fake.calls, [
    ['query', [second]], ['move', SID], ['schedule', SID, 0],
    ['move', second], ['schedule', second, 0],
  ]);
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

const recordId = '33333333-3333-4333-8333-333333333333';
test('editing an unlinked record with an explicit future date/time confirms the owned schedule and reserves one start alert', async () => {
  fake.reset();
  const result = await post.synchronizeEditedWorklogReminder({},
    { recordId, schedule: null, dueDate: '2099-01-01', dueTime: '09:00' }, () => true);
  assert.equal(result, 'created');
  assert.deepEqual(fake.calls, [
    ['confirm', recordId, '2099-01-01T09:00:00+09:00'],
    ['move', SID], ['schedule', SID, 0],
  ]);
});
test('editing a linked record uses the existing schedule and never invokes new confirmation', async () => {
  fake.reset();
  const result = await post.synchronizeEditedWorklogReminder({},
    { recordId, schedule, dueDate: '2099-01-01', dueTime: '09:00' }, () => true);
  assert.equal(result, 'linked');
  assert.deepEqual(fake.calls, [['move', SID], ['schedule', SID, 0]]);
});
test('date-only, stale, and past edits must not create reminders', async () => {
  fake.reset();
  assert.equal(await post.synchronizeEditedWorklogReminder({},
    { recordId, schedule: null, dueDate: '2099-01-01', dueTime: '' }, () => true), 'no-time');
  await assert.rejects(post.synchronizeEditedWorklogReminder({},
    { recordId, schedule: null, dueDate: '2000-01-01', dueTime: '09:00' }, () => true), /TIME_INVALID/);
  await assert.rejects(post.synchronizeEditedWorklogReminder({},
    { recordId, schedule: null, dueDate: '2099-01-01', dueTime: '09:00' }, () => false), /STALE/);
  assert.deepEqual(fake.calls, []);
});
test('server confirmation failure prevents native alarm creation without discarding edited record', async () => {
  fake.reset();
  fake.setConfirmationError(new Error('PGRST202: RPC unavailable'));
  await assert.rejects(post.synchronizeEditedWorklogReminder({},
    { recordId, schedule: null, dueDate: '2099-01-01', dueTime: '09:00' }, () => true), /PGRST202/);
  assert.deepEqual(fake.calls, [['confirm', recordId, '2099-01-01T09:00:00+09:00']]);
});
