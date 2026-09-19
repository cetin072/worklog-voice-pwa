import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import test from 'node:test';

register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { loadNotificationPreferences, updateNotificationPreferences } = await import('../mobile/src/platform/worklog-api.ts');
const appSource = readFileSync(new URL('../mobile/app/index.tsx', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../mobile/src/features/settings/reminder-settings.tsx', import.meta.url), 'utf8');
const localNotificationSource = readFileSync(new URL('../mobile/src/features/schedule/local-notifications.ts', import.meta.url), 'utf8');
const scheduleActionsSource = readFileSync(new URL('../mobile/src/features/schedule/schedule-device-actions.tsx', import.meta.url), 'utf8');

const preferences = {
  ok: true,
  morningEnabled: true,
  afternoonEnabled: false,
  detailEnabled: true,
  morningTime: '08:30',
  afternoonTime: '16:30',
  timezone: 'Asia/Seoul',
  connected: true,
};

test('mobile reads and changes only authenticated server Push preferences', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(preferences);
  };
  try {
    assert.equal((await loadNotificationPreferences('session-token')).morningEnabled, true);
    assert.equal((await updateNotificationPreferences('session-token', { afternoonEnabled: true })).connected, true);
  } finally { globalThis.fetch = originalFetch; }
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers.authorization, 'Bearer session-token');
  assert.equal(calls[1].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].init.body), { afternoonEnabled: true });
  assert.equal(calls[1].init.headers.authorization, 'Bearer session-token');
});

test('mobile rejects malformed server Push state rather than showing an unverified setting', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ ...preferences, connected: 'yes' });
  try { await assert.rejects(loadNotificationPreferences('session-token'), /서버 알림 상태/); }
  finally { globalThis.fetch = originalFetch; }
});

test('settings separates native Local Notification from Web/PWA Push and keeps diagnostics collapsed by default', () => {
  assert.match(appSource, /title="알림·리마인더"/);
  assert.match(appSource, /screen === 'reminderSettings'/);
  assert.match(settingsSource, /Notifications\.getPermissionsAsync\(\)/);
  assert.match(settingsSource, /requestScheduleNotificationPermission/);
  assert.match(settingsSource, /이 모바일 앱은 서버 Push를 직접 받지 않습니다/);
  assert.match(settingsSource, /오전 업무 알림/);
  assert.match(settingsSource, /오후 미완료 알림/);
  assert.match(settingsSource, /const \[diagnosticsOpen, setDiagnosticsOpen\] = useState\(false\)/);
  assert.match(settingsSource, /알림 테스트·문제 해결/);
  assert.match(settingsSource, /Linking\.openSettings\(\)/);
});

test('new schedule reminder choices expose only 30 minutes and one day while legacy reservations remain cancellable', () => {
  assert.match(localNotificationSource, /PRIMARY_REMINDER_PRESETS = REMINDER_PRESETS\.filter\(\(preset\) => preset\.offsetMinutes === 30 \|\| preset\.offsetMinutes === 1440\)/);
  assert.match(scheduleActionsSource, /PRIMARY_REMINDER_PRESETS\.map/);
  assert.doesNotMatch(scheduleActionsSource.slice(scheduleActionsSource.indexOf('이 일정 알림'), scheduleActionsSource.indexOf('legacyReminders')), /REMINDER_PRESETS\.map/);
  assert.match(scheduleActionsSource, /const legacyReminders = reminders\.filter/);
  assert.match(scheduleActionsSource, /기존 예약/);
  assert.match(scheduleActionsSource, /toggleReminder\(reminder\.offsetMinutes/);
});

