import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const webIndex = fs.readFileSync('public/index.html', 'utf8');
const mobileHome = fs.readFileSync('mobile/app/index.tsx', 'utf8');
const mobileProvider = fs.readFileSync('mobile/src/providers/platform-provider.tsx', 'utf8');
const mobileTheme = fs.readFileSync('mobile/src/ui/theme.ts', 'utf8');
const voiceDock = fs.readFileSync('mobile/src/features/voice/voice-recorder-card.tsx', 'utf8');
const scheduleActions = fs.readFileSync('mobile/src/features/schedule/schedule-device-actions.tsx', 'utf8');

test('full parity sweep carries the web welcome, account creation, and login hierarchy into native', () => {
  for (const copy of ['나의 개인 업무공간', '업무를 놓치지 않는', '말하거나 직접 입력', '오늘·다가오는 일정 확인', 'Google로 시작', '무료로 시작']) {
    assert.match(webIndex, new RegExp(copy));
    assert.match(mobileHome, new RegExp(copy));
  }
  assert.match(mobileHome, /authMode === 'signUp'/);
  assert.match(mobileHome, /autoComplete=\{authMode === 'signUp' \? 'new-password'/);
  assert.match(mobileProvider, /client\.auth\.signUp/);
  assert.match(mobileProvider, /confirmationRequired/);
});

test('full parity sweep uses one native token source across shell, voice dock, and schedule controls', () => {
  for (const token of ['overdueBackground', 'todayBackground', 'upcomingBackground', 'neutralBackground', 'touchTarget', 'input']) {
    assert.match(mobileTheme, new RegExp(token));
  }
  assert.match(mobileHome, /mobileTheme\.colors\.overdueBackground/);
  assert.match(mobileHome, /mobileTheme\.size\.input/);
  assert.match(voiceDock, /mobileTheme\.colors\.primary/);
  assert.match(scheduleActions, /mobileTheme\.colors\.borderSubtle/);
});

test('settings mirrors the web grouping instead of rendering a flat action list', () => {
  for (const label of ['계정', '일정·알림', '앱 정보', '계정 작업', '일정·알림 관리', '업데이트·패치노트', '로그아웃']) {
    assert.match(mobileHome, new RegExp(label));
  }
  assert.match(mobileHome, /SettingsMenuItem/);
  assert.match(mobileHome, /settingsGroup/);
});


test('Quick Voice keeps the web-like transparent treatment without an authenticated-home overlay and Home keeps Calendar truth visible', () => {
  assert.doesNotMatch(mobileHome, /quickDockShell|quickDockHeight|position: 'absolute'/);
  assert.match(voiceDock, /quickDock: \{ backgroundColor: 'transparent'/);
  assert.match(mobileHome, /showDeviceStatus/);
  assert.match(scheduleActions, /compactOnly/);
  assert.match(scheduleActions, /connectedCalendarLabel/);
});


test('settings keeps Calendar truth visible before entering detailed controls', () => {
  assert.match(mobileHome, /CalendarConnectionSummary compact[^>]*onPressManage=\{\(\) => setScreen\('scheduleSettings'\)\}/);
  assert.match(mobileHome, /일정·알림 관리/);
  assert.match(mobileHome, /로그아웃/);
});
