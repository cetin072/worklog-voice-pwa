import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const notifications = fs.readFileSync('mobile/src/features/schedule/local-notifications.ts', 'utf8');
const actions = fs.readFileSync('mobile/src/features/schedule/schedule-device-actions.tsx', 'utf8');

test('Reminder changes schedule the replacement before cancelling the prior identifier and retain rollback cleanup', () => {
  const schedule = notifications.indexOf('const identifier = await Notifications.scheduleNotificationAsync');
  const cancelPrevious = notifications.indexOf('await Notifications.cancelScheduledNotificationAsync(previous.identifier);', schedule);
  const rollback = notifications.indexOf('await Notifications.cancelScheduledNotificationAsync(identifier);', cancelPrevious);
  const queue = notifications.indexOf('await queueNotificationCleanup(scheduleId, identifier);', rollback);
  const error = notifications.indexOf("throw new Error('기존 일정 알림을 취소하지 못해 변경을 되돌렸습니다.", queue);

  assert.ok(schedule >= 0);
  assert.ok(cancelPrevious > schedule);
  assert.ok(rollback > cancelPrevious);
  assert.ok(queue > rollback);
  assert.ok(error > queue);
  assert.match(notifications, /PENDING_NOTIFICATION_CLEANUP_KEY/);
  assert.match(notifications, /savePendingNotificationCleanup\(unresolvedPending\)/);
  assert.match(notifications, /await queueNotificationCleanup\(scheduleId, previous\.identifier\)/);
  assert.match(notifications, /if \(queuedForCleanup\) throw new Error/);
});

test('Schedule detail reconciles saved reminders when the schedule time or title changes', () => {
  assert.match(notifications, /export async function synchronizeScheduleReminders/);
  assert.match(notifications, /reminderTriggerAt\(scheduleStartsAt, reminder\.offsetMinutes\)/);
  assert.match(notifications, /cancelScheduleReminder\(scheduleId, reminder\.offsetMinutes\)/);
  assert.match(actions, /synchronizeScheduleReminders\(\{ scheduleId, title: deviceSchedule\.title/);
  assert.match(actions, /\[scheduleId, startsAt, schedule\.title\]/);
  assert.match(actions, /finally \{ await refreshReminders\(\)\.catch\(\(\) => undefined\); setBusy\(false\); \}/);
});
