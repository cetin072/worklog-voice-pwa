import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import test from 'node:test';

register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { loadNotificationPreferences, updateNotificationPreferences } = await import('../mobile/src/platform/worklog-api.ts');
const appSource = readFileSync(new URL('../mobile/app/index.tsx', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../mobile/src/features/settings/reminder-settings.tsx', import.meta.url), 'utf8');
const localNotificationSource = readFileSync(new URL('../mobile/src/features/schedule/local-notifications.ts', import.meta.url), 'utf8');

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

test('notification infrastructure remains available while per-schedule device UI is temporarily removed', () => {
  assert.match(localNotificationSource, /PRIMARY_REMINDER_PRESETS = REMINDER_PRESETS\.filter\(\(preset\) => preset\.offsetMinutes === 30 \|\| preset\.offsetMinutes === 1440\)/);
  assert.equal(readFileSync(new URL('../mobile/src/features/settings/reminder-settings.tsx', import.meta.url), 'utf8').includes('외부 Calendar와 일정별 기기 동기화는 보이스 안정화 후 다시 설계합니다.'), true);
  assert.doesNotMatch(appSource, /scheduleSettings|ScheduleDeviceActions|CalendarConnection/);
});

