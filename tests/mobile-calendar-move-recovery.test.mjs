import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('mobile/src/features/schedule/device-calendar.ts', 'utf8');

test('Cross-calendar move keeps the old mapping until the old event is deleted or the new event is queued for cleanup', () => {
  const createNewEvent = source.indexOf('const event = await calendar.createEvent');
  const deleteOldEvent = source.indexOf('await deleteCalendarEvent(current.eventId);', createNewEvent);
  const rollbackNewEvent = source.indexOf('await deleteCalendarEvent(event.id);', deleteOldEvent);
  const persistCleanup = source.indexOf('pendingCleanup: appendPendingCleanup(current, { calendarId, eventId: event.id })', rollbackNewEvent);
  const moveError = source.indexOf("throw new Error('기존 캘린더 일정을 제거하지 못해 이동을 취소했습니다.", persistCleanup);
  const replaceMapping = source.indexOf('mappings[schedule.scheduleId] = { calendarId, eventId: event.id', moveError);

  assert.ok(createNewEvent >= 0, 'new calendar event must be created before move cleanup');
  assert.ok(deleteOldEvent > createNewEvent, 'old event delete is attempted after creating the new event');
  assert.ok(rollbackNewEvent > deleteOldEvent, 'old delete failure rolls the new event back');
  assert.ok(persistCleanup > rollbackNewEvent, 'rollback failure is stored durably before reporting the move failure');
  assert.ok(moveError > persistCleanup, 'the move reports failure without replacing the old mapping');
  assert.ok(replaceMapping > moveError, 'new mapping replacement remains outside the failure path');
});

test('Calendar orphan cleanup is retried at app start and schedule removal retains failed mappings', () => {
  assert.match(source, /export async function reconcileCalendarEventCleanup\(\)/);
  assert.match(source, /for \(const cleanup of mapping\.pendingCleanup\)/);
  assert.match(source, /if \(changed\) await writeMappings\(mappings\)/);
  assert.match(source, /Retain the mapping so a user-initiated removal or cancellation can retry/);
});
