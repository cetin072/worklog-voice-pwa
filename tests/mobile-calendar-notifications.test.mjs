import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(fs.readFileSync('mobile/package.json', 'utf8'));
const appJson = JSON.parse(fs.readFileSync('mobile/app.json', 'utf8'));
const notificationSource = fs.readFileSync('mobile/src/features/schedule/local-notifications.ts', 'utf8') + fs.readFileSync('mobile/src/features/schedule/schedule-reminder-service.ts', 'utf8');
const cancellationSource = fs.readFileSync('mobile/src/features/schedule/schedule-cancellation.ts', 'utf8');
const homeSource = fs.readFileSync('mobile/app/index.tsx', 'utf8');

test('External Calendar integration is removed from the mobile runtime', () => {
  assert.equal(packageJson.dependencies['expo-calendar'], undefined);
  assert.ok(!appJson.expo.android.permissions.includes('android.permission.READ_CALENDAR'));
  assert.ok(!appJson.expo.android.permissions.includes('android.permission.WRITE_CALENDAR'));
  assert.ok(!appJson.expo.plugins.some((plugin) => Array.isArray(plugin) ? plugin[0] === 'expo-calendar' : plugin === 'expo-calendar'));
  for (const path of [
    'mobile/src/features/schedule/device-calendar.ts',
    'mobile/src/features/schedule/calendar-connection-summary.tsx',
    'mobile/src/features/schedule/calendar-connection-manager.tsx',
    'mobile/src/features/schedule/schedule-device-actions.tsx',
  ]) assert.equal(fs.existsSync(path), false, `${path} must stay removed`);
  assert.doesNotMatch(homeSource, /CalendarConnection|scheduleSettings|showDeviceStatus|showDeviceActions|reconcileCalendarEventCleanup|Google\/휴대폰 Calendar/);
});

test('Internal schedules stay visible and creatable without external Calendar', () => {
  assert.match(homeSource, /오늘과 다가오는 일정/);
  assert.match(homeSource, /\+ 새 일정/);
  assert.match(homeSource, /ScheduleRows/);
  assert.match(homeSource, /scheduleCreated/);
  assert.match(homeSource, /업무수첩 내부에 저장합니다/);
});

test('Local notifications remain available without Calendar startup recovery', () => {
  assert.equal(packageJson.dependencies['expo-notifications'], '57.0.19');
  assert.match(notificationSource, /requestScheduleNotificationPermission/);
  assert.match(notificationSource, /scheduleNotificationAsync/);
  assert.match(notificationSource, /cancelScheduledNotificationAsync/);
  assert.match(notificationSource, /REMINDER_PRESETS/);
  assert.match(homeSource, /getLastNotificationResponseAsync/);
  assert.match(homeSource, /addNotificationResponseReceivedListener/);
  assert.doesNotMatch(homeSource, /reconcileScheduleReminders|reconcileCanceledScheduleArtifacts|reconcileHomeCalendar|reconcileHomeReminders/);
});

test('Schedule cancellation cleans only local reminder artifacts', () => {
  assert.doesNotMatch(cancellationSource, /device-calendar|Calendar|removeScheduleFromCalendar|listTrackedCalendarScheduleIds/);
  assert.match(cancellationSource, /cancelAllScheduleReminders/);
  assert.match(cancellationSource, /listTrackedReminderScheduleIds/);
  assert.match(cancellationSource, /reconcileCanceledScheduleArtifacts/);
});
