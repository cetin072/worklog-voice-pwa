import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const read = path => readFileSync(resolve(path), 'utf8');
const retired = [
  'netlify/functions/morning-push.mts',
  'netlify/functions/afternoon-push.mts',
  'netlify/functions/push-test.mts',
  'netlify/functions/push-test-closed-background.mts',
  'netlify/functions/morning-push-preview.mts',
  'netlify/functions/afternoon-push-preview.mts',
  'netlify/functions/push-subscription.mts',
  'netlify/functions/notification-preferences.mts',
];

test('PWA Web Push automated sends are retired and no Cron remains', () => {
  for (const file of retired) {
    const source = read(file);
    assert.doesNotMatch(source, /sendWebPush|claimMorning|claimAfternoon|schedule:/, file);
    assert.doesNotMatch(source, /NOTIFICATION_SCHEDULER_SECRET|VAPID_PRIVATE_KEY/, file);
  }
  for (const file of retired.slice(0, 2)) {
    assert.match(read(file), /status: 204/, file);
  }
});

test('obsolete public Web Push endpoints fail closed without user data mutation', () => {
  for (const file of retired.slice(2)) {
    const content = read(file);
    assert.match(content, /WEB_PUSH_RETIRED/, file);
    assert.match(content, /status: 410/, file);
    assert.doesNotMatch(content, /\.upsert\(|\.update\(|\.delete\(/, file);
  }
});

test('retired PWA cannot load Push assets or process Web Push events', () => {
  const html = read('public/settings.html');
  const sw = read('public/sw.js');
  const script = read('public/settings.js');
  for (const file of ['notifications.js', 'push-settings.js', 'morning-push-settings.js']) {
    assert.equal(existsSync('public/' + file), false);
    assert.ok(!html.includes(file));
    assert.ok(!sw.includes(file));
  }
  assert.doesNotMatch(sw, /addEventListener\(\s*['"](?:push|notificationclick)['"]/);
  assert.doesNotMatch(html, /settingsMorningPushEnabled|settingsAfternoonPushEnabled|settingsServerPushTest|settingsNotificationTest/);
  assert.doesNotMatch(script, /WorklogNotifications|showTestNotification|requestPermission/);
  assert.match(sw, /addEventListener\("fetch"/);
});

test('native Android Schedule notifications remain untouched by Web Push retirement', () => {
  const native = read('mobile/src/features/schedule/local-notifications.ts');
  const settings = read('mobile/src/features/settings/reminder-settings.tsx');
  assert.match(native, /Notifications\.scheduleNotificationAsync/);
  assert.match(native, /worklog-schedule-reminders/);
  assert.match(settings, /getScheduleReminderStatus/);
});
