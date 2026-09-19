import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const adapter = fs.readFileSync('mobile/src/features/schedule/local-notifications.ts', 'utf8');
const service = fs.readFileSync('mobile/src/features/schedule/schedule-reminder-service.ts', 'utf8');
const actions = fs.readFileSync('mobile/src/features/schedule/schedule-device-actions.tsx', 'utf8');

test('Source contract: notification adapter delegates to journalled production state machine', () => {
  assert.match(adapter, /createScheduleReminderService/);
  assert.match(adapter, /storage: secureSessionStorage/);
  assert.match(adapter, /identifier: reminder\.identifier/);
  assert.match(service, /deps\.storage\.updateItem/);
  assert.match(service, /intents/);
  assert.match(service, /legacyCleanup/);
  assert.match(service, /protectedIds/);
  assert.match(service, /OWNERSHIP_MISMATCH/);
  // Native-failure ordering is executed in mobile-reminders.runtime.test.mjs.
});

test('Source contract: device UI consumes failures and guards stale effects instead of hiding them', () => {
  assert.match(actions, /collectDeviceSyncResult/);
  assert.match(actions, /synchronizeScheduleReminders\(\{ scheduleId, title: deviceSchedule\.title/);
  assert.match(actions, /requestVersion/);
  assert.match(actions, /schedule\.allDay, schedule\.location, retryKey/);
  assert.match(actions, /기기 반영 다시 확인/);
  assert.match(actions, /마지막 저장된 알림 정보/);
  assert.doesNotMatch(actions, /\.catch\(\(\) => undefined\)/);
});
