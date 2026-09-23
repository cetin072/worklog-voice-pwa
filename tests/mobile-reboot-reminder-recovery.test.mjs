import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const appJson = JSON.parse(fs.readFileSync('mobile/app.json', 'utf8'));
const pluginPath = 'mobile/plugins/with-worklog-boot-reminder-recovery.js';
const pluginSource = fs.readFileSync(pluginPath, 'utf8');

test('Android reminders have an explicit native reboot recovery path', () => {
  assert.ok(appJson.expo.android.permissions.includes('android.permission.SCHEDULE_EXACT_ALARM'));
  assert.ok(appJson.expo.android.permissions.includes('android.permission.RECEIVE_BOOT_COMPLETED'));
  assert.ok(appJson.expo.plugins.includes('./plugins/with-worklog-boot-reminder-recovery.js'));

  assert.match(pluginSource, /ReminderBootReceiver/);
  assert.match(pluginSource, /ExpoSchedulingDelegate/);
  assert.match(pluginSource, /setupScheduledNotifications\(\)/);
  assert.match(pluginSource, /goAsync\(\)/);

  for (const action of [
    'android.intent.action.BOOT_COMPLETED',
    'android.intent.action.REBOOT',
    'android.intent.action.USER_UNLOCKED',
    'android.intent.action.MY_PACKAGE_REPLACED',
    'android.intent.action.QUICKBOOT_POWERON',
    'com.htc.intent.action.QUICKBOOT_POWERON',
    'android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED',
  ]) {
    assert.ok(pluginSource.includes(action), 'missing recovery action: ' + action);
  }
});

test('reboot recovery replays Expo native scheduled requests instead of creating a second reminder store', () => {
  assert.doesNotMatch(pluginSource, /SharedPreferences|SecureStore|scheduleNotificationAsync|createScheduleReminderService/);
  assert.match(pluginSource, /same native store/);
  assert.equal((pluginSource.match(/setupScheduledNotifications\\(\\)/g) || []).length, 1);
});
