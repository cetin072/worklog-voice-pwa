import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const source = fs.readFileSync('mobile/src/features/schedule/device-calendar.ts', 'utf8');

test('Source contract: Calendar creations have a durable marker before OS create and mapping ownership before cleanup', () => {
  const persistIntent = source.indexOf('await setIntent(schedule.scheduleId, intent);');
  const create = source.indexOf('const event = await calendar.createEvent', persistIntent);
  assert.ok(persistIntent >= 0 && create > persistIntent);
  assert.match(source, /notes: intent\.marker/);
  assert.match(source, /kind: 'rollback'/);
  assert.match(source, /saved\?\.eventId !== event\.id/);
  assert.match(source, /New mapping and old-event cleanup ownership are durable/);
  assert.match(source, /pendingCleanup/);
});

test('Source contract: Calendar recovery uses durable intents and disconnect opt-out, not a process-only map', () => {
  assert.match(source, /reconcileCalendarEventCleanup/);
  assert.match(source, /calendarOperation/);
  assert.match(source, /CALENDAR_OPTOUT_KEY/);
  assert.match(source, /await setOptOut\(scheduleId, true\)/);
  assert.match(source, /재생성을 보류/);
  assert.match(source, /Retain the mapping so a user-initiated removal or cancellation can retry/);
});
