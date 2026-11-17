import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { createGoogleCalendarAdapter } = await import('../mobile/src/features/calendar/google-calendar-adapter.ts');
const { createCalendarConnection } = await import('../mobile/src/features/calendar/calendar-connection.ts');
const { calendarReadRange, mergeCalendarEvents, calendarReadMessage } = await import('../mobile/src/features/calendar/calendar-read.ts');
const { eventsOnDay } = await import('../mobile/src/features/home/home-calendar-model.ts');
const range = calendarReadRange('2026-11');
const target = { accountId: 'google-owner', calendarId: 'primary' };
const timed = (id, overrides = {}) => ({ id, summary: '회의', status: 'confirmed', start: { dateTime: '2026-11-17T09:00:00+09:00' }, end: { dateTime: '2026-11-17T10:00:00+09:00' }, ...overrides });
test('list reads all pages, expands recurrences, scopes time and sends only GET; all-day end is exclusive in Seoul', async () => {
  const calls = [];
  const adapter = createGoogleCalendarAdapter(target, 'synthetic-only', async (url, options) => {
    calls.push({ url: new URL(url), options });
    return Response.json(calls.length === 1 ? { items: [timed('recurring_20261117'), { id: 'all-day', start: { date: '2026-11-16' }, end: { date: '2026-11-18' } }], nextPageToken: 'page-two' }
      : { items: [timed('recurring_20261118', { start: { dateTime: '2026-11-18T00:00:00Z' }, end: { dateTime: '2026-11-18T01:00:00Z' } }), timed('cancelled', { status: 'cancelled' }), timed('recurring_20261117')] });
  });
  const result = await adapter.list(range, () => true);
  assert.equal(result.limited, false); assert.equal(result.events.length, 3);
  for (const { url, options } of calls) {
    assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
    assert.equal(url.pathname, '/calendar/v3/calendars/primary/events');
    assert.equal(url.searchParams.get('singleEvents'), 'true'); assert.equal(url.searchParams.get('timeMin'), range.start);
    assert.equal(url.searchParams.get('timeMax'), range.end); assert.equal(url.searchParams.get('timeZone'), 'Asia/Seoul');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-only');
  }
  assert.equal(calls[1].url.searchParams.get('pageToken'), 'page-two');
  const allDay = result.events.find(e => e.all_day);
  assert.equal(allDay.starts_at, '2026-11-16T00:00:00+09:00');
  assert.equal(eventsOnDay([allDay], '2026-11-17').length, 1); assert.equal(eventsOnDay([allDay], '2026-11-18').length, 0);
  assert.ok(result.events.every(e => !e.editable && e.source === 'external'));
  assert.ok(!JSON.stringify(result).includes('synthetic-only'));
});
test('empty pages continue, pagination is bounded, corrupt records are flagged instead of complete emptiness', async () => {
  let pages = 0;
  const adapter = createGoogleCalendarAdapter(target, 't', async () => Response.json({ items: [], nextPageToken: String(++pages) }));
  assert.equal((await adapter.list(range, () => true)).limited, true); assert.equal(pages, 4);
  const malformed = createGoogleCalendarAdapter(target, 't', async () => Response.json({ items: [timed('bad', { start: { date: '2026-02-30' } }), timed('no-zone', { start: { dateTime: '2026-11-17T09:00:00' } })] }));
  assert.deepEqual(await malformed.list(range, () => true), { events: [], limited: true });
  const empty = createGoogleCalendarAdapter(target, 't', async () => Response.json({}));
  assert.deepEqual(await empty.list(range, () => true), { events: [], limited: false });
  assert.throws(() => calendarReadRange('bad'), /RANGE/);
  await assert.rejects(adapter.list({ start: range.start, end: '2027-11-01T00:00:00Z' }, () => true), /RANGE/);
});
test('errors and late account results do not expose a successful empty calendar', async () => {
  for (const [status, error] of [[401, 'EXPIRED'], [403, 'DENIED'], [500, 'READ_FAILED']]) {
    const adapter = createGoogleCalendarAdapter(target, 't', async () => new Response('{}', { status }));
    await assert.rejects(adapter.list(range, () => true), new RegExp(error));
  }
  let live = true, requests = 0;
  const adapter = createGoogleCalendarAdapter(target, 't', async () => { requests++; live = false; return Response.json({ items: [timed('private')], nextPageToken: 'two' }); });
  await assert.rejects(adapter.list(range, () => live), /OWNER_CHANGED/); assert.equal(requests, 1);
  const offline = createGoogleCalendarAdapter(target, 't', async () => { throw Error('private error data'); });
  await assert.rejects(offline.list(range, () => true), /CALENDAR_OFFLINE/);
  assert.match(calendarReadMessage(Error('CALENDAR_EXPIRED')), /다시 연결/);
});
test('connection rejects pending reads after disconnect and expired credentials before any request', async () => {
  let finish, count = 0, now = 0;
  const service = createCalendarConnection({ now: () => now, authorize: async () => ({ target, email: 'test@example.invalid', expiresAt: 100,
    adapter: { target, get: async () => null, insert: async () => {}, list: () => { count++; return new Promise(resolve => finish = resolve); } } }) });
  await service.connect(); const pending = service.readEvents(range); service.disconnect(); finish({ events: [timed('private')], limited: false });
  await assert.rejects(pending, /OWNER_CHANGED/);
  await service.connect(); now = 101; await assert.rejects(service.readEvents(range), /EXPIRED/); assert.equal(count, 1);
});
test('only matching exported schedule copies are hidden; changed Google events and same-title meetings remain', async () => {
  const id = '22222222-2222-4222-8222-222222222222';
  const row = timed('a' + id.replaceAll('-', ''), { extendedProperties: { private: { worklogScheduleId: id } } });
  const adapter = createGoogleCalendarAdapter(target, 't', async () => Response.json({ items: [row, timed('unrelated')] }));
  const { events } = await adapter.list(range, () => true);
  const local = { ...events[0], id, source: 'personal', editable: true };
  assert.equal(mergeCalendarEvents([local], events).length, 2);
  assert.equal(mergeCalendarEvents([{ ...local, title: '변경됨' }], events).length, 3);
  assert.equal(mergeCalendarEvents([{ ...local, status: 'cancelled' }], events).length, 3);
  assert.equal(mergeCalendarEvents([], events).length, 2);
});
