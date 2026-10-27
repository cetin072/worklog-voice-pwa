import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { createCalendarExporter, calendarEventId, validateCalendarDraft } = await import('../mobile/src/features/calendar/calendar-export.ts');
const { createGoogleCalendarAdapter } = await import('../mobile/src/features/calendar/google-calendar-adapter.ts');
const target = { accountId: 'synthetic-account', calendarId: 'synthetic-calendar' };
const draft = { scheduleId: '22222222-2222-4222-8222-222222222222', title: '검수용 <일정> & 회의', status: 'confirmed', allDay: false, timeZone: 'Asia/Seoul', start: '2026-10-28T10:00:00+09:00', end: '2026-10-28T11:00:00+09:00' };
const id = calendarEventId(draft.scheduleId);
const receipt = { id, status: 'confirmed', sourceId: draft.scheduleId };
function driver(overrides = {}) {
  let event = null; let writes = 0;
  return { target, get: async () => event, insert: async () => { writes++; event = receipt; return event; }, count: () => writes, ...overrides };
}
test('no grant, cancellation, wrong account, nonconfirmed schedules never write', async () => {
  assert.equal((await createCalendarExporter(null)(draft, target)).state, 'blocked');
  const d = driver(); const send = createCalendarExporter(d);
  assert.equal((await send(draft, null)).state, 'cancelled');
  assert.equal((await send(draft, { ...target, accountId: 'other' })).state, 'blocked');
  assert.equal((await send({ ...draft, status: 'cancelled' }, target)).state, 'blocked');
  assert.equal((await send({ ...draft, status: 'tentative' }, target)).state, 'blocked');
  assert.equal(d.count(), 0);
});
test('double click, relaunch and changed title keep one server event and read back confirmation', async () => {
  const d = driver(); const send = createCalendarExporter(d);
  const a = send(draft, target); const b = send(draft, target); assert.equal(a, b);
  assert.equal((await a).state, 'confirmed'); assert.equal(d.count(), 1);
  assert.deepEqual(await createCalendarExporter(d)({ ...draft, title: '변경 제목' }, target), { state: 'confirmed', eventId: id, alreadyExists: true });
  assert.equal(d.count(), 1); assert.match(id, /^[a-v0-9]{5,1024}$/);
});
test('write committed but response lost is reconciled; offline/read failure/unknown result is not success', async () => {
  let event = null;
  const d = driver({ get: async () => event, insert: async () => { event = receipt; throw Error('network lost'); } });
  assert.equal((await createCalendarExporter(d)(draft, target)).state, 'confirmed');
  for (const overrides of [
    { get: async () => { throw Error('offline'); } },
    { insert: async () => { throw Error('offline'); } },
    { insert: async () => receipt }, // POST claims success, GET still absent
  ]) assert.equal((await createCalendarExporter(driver(overrides))(draft, target)).state, 'unknown');
});
test('deleted/foreign event and stale account never overwrite or report success', async () => {
  for (const existing of [{ ...receipt, status: 'cancelled' }, { ...receipt, sourceId: 'foreign' }]) {
    const d = driver({ get: async () => existing });
    assert.equal((await createCalendarExporter(d)(draft, target)).state, 'blocked'); assert.equal(d.count(), 0);
  }
  let current = true;
  const d = driver({ get: async () => { current = false; return null; } });
  assert.equal((await createCalendarExporter(d)(draft, target, () => current)).state, 'unknown'); assert.equal(d.count(), 0);
});
test('explicit offsets, valid dates, end and all-day exclusive date are mandatory', () => {
  validateCalendarDraft(draft);
  validateCalendarDraft({ ...draft, allDay: true, start: '2026-10-28', end: '2026-10-29' });
  for (const change of [{ title: '' }, { timeZone: 'Bad/Zone' }, { start: '2026-02-30T10:00:00+09:00' }, { start: '2026-10-28T10:00:00' }, { end: draft.start }, { allDay: true, start: '2026-02-30', end: '2026-03-02' }]) assert.throws(() => validateCalendarDraft({ ...draft, ...change }));
});
test('real HTTP adapter uses exact calendar, preserves title/timezone/all-day, never lists or changes existing events', async () => {
  const calls = []; let stored;
  const api = createGoogleCalendarAdapter(target, 'synthetic-not-a-token', async (url, opts) => {
    calls.push({ url, opts });
    if (opts.method === 'POST') { stored = JSON.parse(opts.body); return Response.json({ ...stored, status: 'confirmed' }); }
    return stored ? Response.json({ ...stored, status: 'confirmed' }) : new Response('', { status: 404 });
  });
  assert.equal((await createCalendarExporter(api)(draft, target)).state, 'confirmed');
  assert.deepEqual(calls.map(c => c.opts.method), ['GET', 'POST', 'GET']);
  assert.equal(stored.summary, draft.title); assert.deepEqual(stored.start, { dateTime: draft.start, timeZone: 'Asia/Seoul' });
  assert.equal(stored.attendees, undefined); assert.deepEqual(stored.reminders, { useDefault: false });
  await api.insert(id, { ...draft, allDay: true, start: '2026-10-28', end: '2026-10-29' });
  assert.deepEqual(stored.start, { date: '2026-10-28' }); assert.deepEqual(stored.end, { date: '2026-10-29' });
});
test('HTTP denial, conflict and tombstones cannot become false success', async () => {
  for (const status of [401, 403, 409, 429, 500]) {
    const api = createGoogleCalendarAdapter(target, 'synthetic', async () => new Response('', { status }));
    assert.equal((await createCalendarExporter(api)(draft, target)).state, 'unknown');
  }
  const api = createGoogleCalendarAdapter(target, 'synthetic', async () => new Response('', { status: 410 }));
  assert.equal((await createCalendarExporter(api)(draft, target)).state, 'blocked');
});
