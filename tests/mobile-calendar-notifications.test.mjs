import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(fs.readFileSync('mobile/package.json', 'utf8'));
const appJson = JSON.parse(fs.readFileSync('mobile/app.json', 'utf8'));
const calendarSource = fs.readFileSync('mobile/src/features/schedule/device-calendar.ts', 'utf8');
const notificationSource = fs.readFileSync('mobile/src/features/schedule/local-notifications.ts', 'utf8');
const scheduleActionsSource = fs.readFileSync('mobile/src/features/schedule/schedule-device-actions.tsx', 'utf8');
const cancellationSource = fs.readFileSync('mobile/src/features/schedule/schedule-cancellation.ts', 'utf8');
const homeSource = fs.readFileSync('mobile/app/index.tsx', 'utf8');

test('Mobile calendar uses the OS provider with writable-calendar permission and local event mapping', () => {
  assert.equal(packageJson.dependencies['expo-calendar'], '57.0.4');
  assert.ok(appJson.expo.android.permissions.includes('android.permission.WRITE_CALENDAR'));
  assert.match(calendarSource, /getCalendars/);
  assert.match(calendarSource, /allowsModifications/);
  assert.match(calendarSource, /syncScheduleToCalendar/);
  assert.match(calendarSource, /CALENDAR_MAPPING_KEY/);
  assert.match(calendarSource, /Asia\/Seoul/);
});

test('Calendar and reminder V2 keep the OS-provider selection and multiple explicit presets visible', () => {
  assert.equal(packageJson.dependencies['expo-notifications'], '57.0.19');
  assert.match(calendarSource, /ownerAccount/);
  assert.match(calendarSource, /isPrimary/);
  assert.match(calendarSource, /setPreferredCalendarId/);
  assert.match(calendarSource, /current\.calendarId === calendarId/);
  assert.match(calendarSource, /current\.calendarId !== calendarId/);
  assert.match(calendarSource, /ExpoCalendarEvent\.get\(current\.eventId\)\)\.delete/);
  assert.match(scheduleActionsSource, /mapping\?\.calendarId \|\| preferred/);
  assert.match(notificationSource, /requestScheduleNotificationPermission/);
  assert.match(notificationSource, /scheduleNotificationAsync/);
  assert.match(notificationSource, /cancelScheduledNotificationAsync/);
  assert.match(notificationSource, /cancelAllScheduleReminders/);
  assert.match(notificationSource, /REMINDER_PRESETS/);
  assert.match(notificationSource, /scheduleId/);
  assert.match(notificationSource, /triggerAt/);
  assert.match(notificationSource, /이미 지났습니다/);
  assert.doesNotMatch(notificationSource, /08:30|09:00|16:30/);
  assert.match(scheduleActionsSource, /Google Calendar \/ 휴대폰 캘린더/);
  assert.match(scheduleActionsSource, /REMINDER_PRESETS/);
  assert.match(scheduleActionsSource, /이 일정 알림 모두 취소/);
  assert.match(scheduleActionsSource, /이 일정 취소/);
  assert.match(scheduleActionsSource, /cancelScheduleWithDeviceCleanup/);
  assert.match(cancellationSource, /reconcileCanceledScheduleArtifacts/);
});

test('Notifications reconcile after app restart, open the linked schedule, and consume the cold-start response', () => {
  assert.match(notificationSource, /reconcileScheduleReminders/);
  assert.match(notificationSource, /getAllScheduledNotificationsAsync/);
  assert.match(notificationSource, /target: 'schedule'/);
  assert.match(homeSource, /getLastNotificationResponseAsync/);
  assert.match(homeSource, /addNotificationResponseReceivedListener/);
  assert.match(homeSource, /clearLastNotificationResponseAsync/);
  assert.match(homeSource, /handleNotificationResponse/);
  assert.match(homeSource, /reconcileCanceledScheduleArtifacts/);
  assert.match(homeSource, /알림.*일정/);
  assert.match(homeSource, /setScreen\('calendar'\)/);
});
