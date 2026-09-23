import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../mobile/app/index.tsx', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../mobile/src/features/settings/reminder-settings.tsx', import.meta.url), 'utf8');
const mobileApiSource = readFileSync(new URL('../mobile/src/platform/worklog-api.ts', import.meta.url), 'utf8');
const localNotificationSource = readFileSync(new URL('../mobile/src/features/schedule/local-notifications.ts', import.meta.url), 'utf8');

test('mobile reminder settings expose only app-local notification state', () => {
  assert.match(appSource, /title="알림·리마인더"/);
  assert.match(appSource, /screen === 'reminderSettings'/);
  assert.match(settingsSource, /Notifications\.getPermissionsAsync\(\)/);
  assert.match(settingsSource, /requestScheduleNotificationPermission/);
  assert.match(settingsSource, /예약된 일정 알림/);
  assert.match(settingsSource, /예약 대기 중/);
  assert.match(settingsSource, /정확한 일정 알림 허용/);
  assert.match(settingsSource, /openExactAlarmPermissionSettings/);
  assert.match(settingsSource, /reconcileScheduleReminders/);
  assert.match(settingsSource, /상태 다시 확인/);
  assert.match(settingsSource, /Linking\.openSettings\(\)/);
  assert.doesNotMatch(settingsSource, /서버 Push|웹\/PWA|오전 업무 알림|오후 미완료 알림/);
});

test('mobile no longer carries the Web/PWA push preferences API client', () => {
  assert.doesNotMatch(mobileApiSource, /NotificationPreferences|notification-preferences|loadNotificationPreferences|updateNotificationPreferences/);
});

test('first timed schedule guides Android exact-alarm special access in context', () => {
  assert.match(appSource, /정확한 시간 알림 설정/);
  assert.match(appSource, /한 번만 설정하면 됩니다/);
  assert.match(appSource, /maybeGuideExactAlarmPermission/);
  assert.match(appSource, /shouldGuideExactAlarmPermission/);
  assert.match(appSource, /markExactAlarmPermissionGuided/);
  assert.match(localNotificationSource, /worklog\.mobile\.exact-alarm-guidance\.v1/);
  assert.match(localNotificationSource, /android\.settings\.REQUEST_SCHEDULE_EXACT_ALARM/);
});

test('local reminder infrastructure stays available without external Calendar UI', () => {
  assert.match(localNotificationSource, /scheduleNotificationAsync/);
  assert.match(localNotificationSource, /android\.settings\.REQUEST_SCHEDULE_EXACT_ALARM/);
  assert.match(localNotificationSource, /getScheduleReminderStatus/);
  assert.match(localNotificationSource, /cancelScheduledNotificationAsync/);
  assert.match(settingsSource, /시간이 있는 일정은 시작 시각에 한 번 알려드립니다/);
  assert.doesNotMatch(appSource, /scheduleSettings|ScheduleDeviceActions|CalendarConnection/);
});
