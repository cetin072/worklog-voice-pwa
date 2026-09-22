import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const adapter = fs.readFileSync('mobile/src/features/schedule/local-notifications.ts', 'utf8');
const service = fs.readFileSync('mobile/src/features/schedule/schedule-reminder-service.ts', 'utf8');
const home = fs.readFileSync('mobile/app/index.tsx', 'utf8');

test('Source contract: notification adapter delegates to journalled production state machine', () => {
  assert.match(adapter, /createScheduleReminderService/);
  assert.match(adapter, /storage: secureSessionStorage/);
  assert.match(adapter, /identifier: reminder\.identifier/);
  assert.match(service, /deps\.storage\.updateItem/);
  assert.match(service, /intents/);
  assert.match(service, /legacyCleanup/);
  assert.match(service, /protectedIds/);
  assert.match(service, /OWNERSHIP_MISMATCH/);
});

test('Home runs only the durable reminder coordinator recovery, not a Calendar synchronizer', () => {
  assert.doesNotMatch(home, /ScheduleDeviceActions|collectDeviceSyncResult|synchronizeScheduleToPreferredCalendar/);
  assert.match(home, /scheduleReminderCoordinator\.recover/);
  assert.match(home, /screen === 'reminderSettings'/);
  assert.match(home, /Notifications\.getLastNotificationResponseAsync/);
});
