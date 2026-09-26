import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const webIndex = fs.readFileSync('public/index.html', 'utf8');
const mobileHome = fs.readFileSync('mobile/app/index.tsx', 'utf8');
const mobileProvider = fs.readFileSync('mobile/src/providers/platform-provider.tsx', 'utf8');
const mobileTheme = fs.readFileSync('mobile/src/ui/theme.ts', 'utf8');
const voiceDock = fs.readFileSync('mobile/src/features/voice/voice-recorder-card.tsx', 'utf8');

test('full parity sweep carries the web welcome, account creation, and login hierarchy into native', () => {
  for (const copy of ['나의 개인 업무공간', '업무를 놓치지 않는', '말하거나 직접 입력', '오늘·다가오는 일정 확인']) {
    assert.match(webIndex, new RegExp(copy));
    assert.match(mobileHome, new RegExp(copy));
  }
  assert.match(webIndex, /Google로 시작/);
  assert.match(mobileHome, /Google로 로그인/);
  assert.match(mobileHome, /Google로 무료 시작/);
  assert.match(webIndex, /무료로 시작/);
  assert.match(mobileHome, /무료 회원가입/);
  assert.match(mobileHome, /새 계정 만들기/);
  assert.match(mobileHome, /authMode === 'signUp'/);
  assert.match(mobileHome, /autoComplete=\{authMode === 'signUp' \? 'new-password'/);
  assert.match(mobileProvider, /client\.auth\.signUp/);
  assert.match(mobileProvider, /confirmationRequired/);
});

test('full parity sweep uses one native token source across shell and voice dock', () => {
  for (const token of ['overdueBackground', 'todayBackground', 'upcomingBackground', 'neutralBackground', 'touchTarget', 'input']) {
    assert.match(mobileTheme, new RegExp(token));
  }
  assert.match(mobileHome, /mobileTheme\.colors\.overdueBackground/);
  assert.match(mobileHome, /mobileTheme\.size\.input/);
  assert.match(voiceDock, /mobileTheme\.colors\.primary/);
});

test('settings keeps account, notifications, app info, and account actions without Calendar controls', () => {
  for (const label of ['계정', '알림', '앱 정보', '계정 작업', '업데이트·패치노트', '로그아웃']) {
    assert.match(mobileHome, new RegExp(label));
  }
  assert.match(mobileHome, /SettingsMenuItem/);
  assert.match(mobileHome, /settingsGroup/);
  assert.doesNotMatch(mobileHome, /일정·알림 관리|CalendarConnection|scheduleSettings|Google\/휴대폰 Calendar/);
});

test('Quick Voice mirrors the web dock with a pass-through floating overlay while Home keeps schedules visible', () => {
  assert.match(mobileHome, /quickVoiceFooter: \{ position: 'absolute'/);
  assert.match(mobileHome, /pointerEvents="box-none"/);
  assert.match(voiceDock, /quickDock: \{ width: QUICK_VOICE_LAYOUT\.dockWidth/);
  assert.match(mobileHome, /quickVoiceFooter/);
  assert.match(mobileHome, /오늘과 다가오는 일정/);
  assert.match(mobileHome, /시간이 있는 일정은 업무수첩에 저장되고 시작 시각에 한 번 알려드립니다/);
});
