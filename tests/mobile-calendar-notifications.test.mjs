import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(fs.readFileSync('mobile/package.json', 'utf8'));
const appJson = JSON.parse(fs.readFileSync('mobile/app.json', 'utf8'));
const calendarSource = fs.readFileSync('mobile/src/features/schedule/device-calendar.ts', 'utf8');
const notificationSource = fs.readFileSync('mobile/src/features/schedule/local-notifications.ts', 'utf8');
const scheduleActionsSource = fs.readFileSync('mobile/src/features/schedule/schedule-device-actions.tsx', 'utf8');

test('Mobile calendar uses the OS provider with writable-calendar permission and local event mapping', () => {
  assert.equal(packageJson.dependencies['expo-calendar'], '57.0.4');
  assert.ok(appJson.expo.android.permissions.includes('android.permission.WRITE_CALENDAR'));
  assert.match(calendarSource, /getCalendars/);
  assert.match(calendarSource, /allowsModifications/);
  assert.match(calendarSource, /syncScheduleToCalendar/);
  assert.match(calendarSource, /CALENDAR_MAPPING_KEY/);
  assert.match(calendarSource, /Asia\/Seoul/);
});

test('Local notifications request permission and deduplicate schedule reminders without inventing a default time', () => {
  assert.equal(packageJson.dependencies['expo-notifications'], '57.0.19');
  assert.match(notificationSource, /requestScheduleNotificationPermission/);
  assert.match(notificationSource, /scheduleNotificationAsync/);
  assert.match(notificationSource, /cancelScheduledNotificationAsync/);
  assert.match(notificationSource, /scheduleId/);
  assert.match(notificationSource, /triggerAt/);
  assert.doesNotMatch(notificationSource, /08:30|09:00|16:30/);
  assert.match(scheduleActionsSource, /일정 시작 시각에 알림/);
  assert.match(scheduleActionsSource, /휴대폰 캘린더 선택/);
});
