import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
const fixture = new URL('./helpers/calendar-native-fake.mjs', import.meta.url).href;
register('./helpers/mobile-ts-loader.mjs', import.meta.url, { data: { mocks: { 'expo-calendar': fixture, 'expo-crypto': fixture, '@/src/platform/secure-storage': fixture } } });
const fake = await import(fixture);
const calendar = await import(process.env.CALENDAR_TEST_SOURCE_URL || new URL('../mobile/src/features/schedule/device-calendar.ts', import.meta.url).href);
const start = '2030-01-01T06:00:00Z';
const later = '2030-01-01T08:00:00Z';
const schedule = (sid = 'A', startsAt = start) => ({ scheduleId: sid, startsAt, title: 'Test meeting' });
const mapKey = 'worklog.mobile.calendar-event-mappings.v1';

test('unselected calendar discovery and automatic synchronization do not select or write events', async () => {
  const w = fake.reset();
  assert.equal(await calendar.resolvePreferredCalendar(), null);
  assert.equal((await calendar.readCalendarConnectionStatus()).state, 'not-selected');
  assert.equal(await calendar.getPreferredCalendarId(), null);
  assert.equal((await calendar.synchronizeScheduleToPreferredCalendar(schedule())).reason, 'not-connected');
  assert.equal(w.events.size, 0);
});

test('explicit per-event move leaves the global default unchanged', async () => {
  const w = fake.reset(); await calendar.setPreferredCalendarId('work');
  await calendar.syncScheduleToCalendar('work', schedule());
  await calendar.syncScheduleToCalendar('personal', schedule());
  assert.equal(await calendar.getPreferredCalendarId(), 'work');
  assert.equal(w.events.size, 1); assert.equal([...w.events.values()][0].calendarId, 'personal');
});

test('concurrent schedules preserve every mapping and concurrent revisions apply the later revision', async () => {
  const w = fake.reset(); await calendar.setPreferredCalendarId('work');
  await Promise.all(Array.from({ length: 12 }, (_, i) => calendar.synchronizeScheduleToPreferredCalendar(schedule(`s${i}`))));
  assert.equal((await calendar.listTrackedCalendarScheduleIds()).length, 12); assert.equal(w.events.size, 12);
  await Promise.all([calendar.synchronizeScheduleToPreferredCalendar(schedule('A', start)), calendar.synchronizeScheduleToPreferredCalendar(schedule('A', later))]);
  const mapping = await calendar.getScheduleCalendarMapping('A');
  assert.equal(new Date(w.events.get(mapping.eventId).startDate).getTime(), Date.parse(later));
  assert.equal(w.events.size, 13);
});

test('temporary update failure never falls through to event creation', async () => {
  const w = fake.reset(); await calendar.syncScheduleToCalendar('work', schedule());
  w.failure = (kind) => { if (kind === 'update-event') throw new Error('database locked'); };
  await assert.rejects(calendar.syncScheduleToCalendar('work', schedule('A', later)));
  assert.equal(w.calls.filter(([k]) => k === 'create').length, 1); assert.equal(w.events.size, 1);
});

test('equal fingerprint verifies the OS; only explicit native not-found allows recreation', async () => {
  const w = fake.reset(); const first = await calendar.syncScheduleToCalendar('work', schedule());
  w.failure = (kind) => { if (kind === 'get-event') throw new Error('permission error'); };
  await assert.rejects(calendar.syncScheduleToCalendar('work', schedule())); assert.equal(w.events.size, 1);
  w.failure = () => {}; w.events.delete(first.eventId);
  await calendar.syncScheduleToCalendar('work', schedule()); assert.equal(w.events.size, 1);
});

test('create acknowledgement lost: restart locates the journal marker and adopts, not duplicates', async () => {
  const w = fake.reset(); w.failure = (kind) => { if (kind === 'event-created') throw new Error('process stopped'); };
  await assert.rejects(calendar.syncScheduleToCalendar('work', schedule())); assert.equal(w.events.size, 1);
  const fresh = fake.reset(w); await calendar.syncScheduleToCalendar('work', schedule());
  assert.equal(fresh.events.size, 1); assert.equal(fresh.calls.filter(([k]) => k === 'create').length, 0);
  assert.ok(await calendar.getScheduleCalendarMapping('A'));
});

test('mapping commit failure rolls back only the newly owned event and leaves a retryable state', async () => {
  const w = fake.reset(); let failed = false;
  w.failure = (kind, key) => { if (!failed && kind === 'write' && key === `${mapKey}__atomic_v1`) { failed = true; throw new Error('mapping failed'); } };
  await assert.rejects(calendar.syncScheduleToCalendar('work', schedule()));
  assert.equal(w.events.size, 0); assert.equal(await calendar.getScheduleCalendarMapping('A'), null);
  await calendar.syncScheduleToCalendar('work', schedule()); assert.equal(w.events.size, 1);
});

test('process stop after creation plus unavailable storage still recovers by marker after restart', async () => {
  const w = fake.reset(); let stopped = false;
  w.failure = (kind) => { if (kind === 'event-created') stopped = true; if (stopped) throw new Error('stopped'); };
  await assert.rejects(calendar.syncScheduleToCalendar('work', schedule()));
  const fresh = fake.reset(w); await calendar.reconcileCalendarEventCleanup();
  assert.equal(fresh.events.size, 1); assert.ok(await calendar.getScheduleCalendarMapping('A'));
});

test('move cleanup failure remains pending and is retried without creating a third event', async () => {
  const w = fake.reset(); const old = await calendar.syncScheduleToCalendar('work', schedule());
  w.failure = (kind, id) => { if (kind === 'delete-event' && id === old.eventId) throw new Error('delete unavailable'); };
  await assert.rejects(calendar.syncScheduleToCalendar('personal', schedule())); assert.equal(w.events.size, 2);
  const fresh = fake.reset(w); const report = await calendar.reconcileCalendarEventCleanup();
  assert.equal(report.remaining, 0); assert.equal(fresh.events.size, 1);
  assert.equal((await calendar.getScheduleCalendarMapping('A')).calendarId, 'personal');
});

test('disconnect persists intent and opt-out; crash/restart does not auto-recreate', async () => {
  const w = fake.reset(); await calendar.setPreferredCalendarId('work'); await calendar.syncScheduleToCalendar('work', schedule());
  w.failure = (kind) => { if (kind === 'event-deleted') throw new Error('stopped'); };
  await assert.rejects(calendar.removeScheduleFromCalendar('A'));
  const fresh = fake.reset(w); await calendar.reconcileCalendarEventCleanup();
  assert.equal((await calendar.synchronizeScheduleToPreferredCalendar(schedule())).reason, 'not-connected');
  assert.equal(fresh.events.size, 0); assert.equal(await calendar.getScheduleCalendarMapping('A'), null);
  await calendar.syncScheduleToCalendar('work', schedule()); assert.equal(fresh.events.size, 1);
});

test('corrupt mappings do not cause blind recreation or deletion', async () => {
  const w = fake.reset(); await fake.secureSessionStorage.setItem(mapKey, '{broken');
  await assert.rejects(calendar.syncScheduleToCalendar('work', schedule()));
  assert.equal(w.calls.filter(([k]) => ['create', 'delete', 'update'].includes(k)).length, 0);
});

test('same title/time user event is never adopted or deleted as a duplicate', async () => {
  const w = fake.reset(); w.events.set('user', { id: 'user', calendarId: 'work', title: 'Test meeting', startDate: new Date(start), endDate: new Date(Date.parse(start) + 3600000), notes: 'User note' });
  await calendar.syncScheduleToCalendar('work', schedule()); assert.equal(w.events.size, 2);
  await calendar.removeScheduleFromCalendar('A'); assert.ok(w.events.has('user')); assert.equal(w.events.size, 1);
});

test('ambiguous create result outside search range fails closed instead of blindly creating again', async () => {
  const w = fake.reset(); w.failure = (kind) => { if (kind === 'create-event') throw new Error('unknown creation outcome'); };
  await assert.rejects(calendar.syncScheduleToCalendar('work', schedule()));
  const fresh = fake.reset(w); await assert.rejects(calendar.syncScheduleToCalendar('work', schedule()), /재생성을 보류/);
  assert.equal(fresh.calls.filter(([k]) => k === 'create').length, 0);
});

test('stale calendar id never falls back to another account', async () => {
  const w = fake.reset(); await calendar.setPreferredCalendarId('missing');
  assert.equal(await calendar.resolvePreferredCalendar(), null);
  await assert.rejects(calendar.synchronizeScheduleToPreferredCalendar(schedule()));
  assert.equal(w.events.size, 0); assert.equal(await calendar.getPreferredCalendarId(), 'missing');
});

test('native creation with wrong data is not declared synchronized and rolls back only owned new event', async () => {
  const w = fake.reset();
  w.failure = (kind, id) => { if (kind === 'event-created') w.events.get(id).title = 'wrong native data'; };
  await assert.rejects(calendar.syncScheduleToCalendar('work', schedule()), /내용이 요청과 다릅니다/);
  assert.equal(w.events.size, 0); assert.equal(await calendar.getScheduleCalendarMapping('A'), null);
});

test('native delete acknowledgement without deletion keeps durable cleanup pending', async () => {
  const w = fake.reset(); const result = await calendar.syncScheduleToCalendar('work', schedule());
  const event = { ...w.events.get(result.eventId) };
  w.failure = (kind, id) => { if (kind === 'event-deleted') w.events.set(id, event); };
  await assert.rejects(calendar.removeScheduleFromCalendar('A'), /삭제 결과/);
  assert.ok(await calendar.getScheduleCalendarMapping('A'));
  const fresh = fake.reset(w); assert.equal((await calendar.reconcileCalendarEventCleanup()).remaining, 0);
  assert.equal(fresh.events.size, 0);
});

test('changed ownership marker blocks automatic update and deletion of the modified event', async () => {
  const w = fake.reset(); const result = await calendar.syncScheduleToCalendar('work', schedule());
  w.events.get(result.eventId).notes = 'manually reassigned';
  await assert.rejects(calendar.syncScheduleToCalendar('work', schedule('A', later)), /식별 메모/);
  await assert.rejects(calendar.removeScheduleFromCalendar('A'), /삭제하지 않았습니다/);
  assert.equal(w.events.size, 1); assert.equal(w.calls.filter(([kind]) => kind === 'update').length, 0);
});

test('overlapping revisions wait for a blocked native create; neither the latest change nor its result is lost', async () => {
  const w = fake.reset();
  let release; let entered;
  const blocked = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  let intercepted = false;
  w.pause = async (kind) => {
    if (kind === 'before-create' && !intercepted) { intercepted = true; entered(); await blocked; }
  };
  const first = calendar.syncScheduleToCalendar('work', schedule());
  await started;
  const second = calendar.syncScheduleToCalendar('work', schedule('A', later));
  const results = Promise.allSettled([first, second]);
  // Flush competing JS/native continuations while the first operation is deliberately held.
  await new Promise(setImmediate);
  release();
  const settled = await results;
  assert.deepEqual(settled.map((r) => r.status), ['fulfilled', 'fulfilled']);
  assert.equal(w.events.size, 1);
  assert.equal(new Date([...w.events.values()][0].startDate).getTime(), Date.parse(later));
});
