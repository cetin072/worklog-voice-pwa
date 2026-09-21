import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const homeSource = fs.readFileSync('mobile/app/index.tsx', 'utf8');
const apiSource = fs.readFileSync('mobile/src/platform/worklog-api.ts', 'utf8');
const recorderSource = fs.readFileSync('mobile/src/features/voice/voice-recorder-card.tsx', 'utf8');
const meetingProviderSource = fs.readFileSync('mobile/src/features/voice/meeting-recording-provider.tsx', 'utf8');
const rootLayoutSource = fs.readFileSync('mobile/app/_layout.tsx', 'utf8');

test('Mobile App Shell preserves the PWA briefing information structure through the existing Data Core endpoint', () => {
  for (const label of ['지난 것', '오늘 할 일', '다가오는 업무', '기한 없는 업무']) {
    assert.match(homeSource, new RegExp(label));
  }
  assert.match(homeSource, /loadBriefing/);
  assert.match(homeSource, /scheduleEnabled/);
  assert.match(homeSource, /Asia\/Seoul/);
  assert.match(apiSource, /MobileBriefing/);
  assert.match(apiSource, /BriefingSchedule/);
});

test('Mobile home keeps quick voice memo primary while meeting recording reuses one recorder core', () => {
  assert.match(homeSource, /VoiceRecorderCard mode="quick"/);
  assert.match(homeSource, /VoiceRecorderCard mode="meeting"/);
  assert.match(homeSource, /회의 녹음/);
  assert.match(recorderSource, /mode = 'quick'/);
  assert.match(recorderSource, /useMeetingRecordingSession/);
  assert.match(meetingProviderSource, /async function start\(\)/);
  assert.match(rootLayoutSource, /MeetingRecordingProvider/);
  assert.doesNotMatch(homeSource, /WebView/);
});

test('Mobile shell provides direct entry, recovery states, and Android back navigation', () => {
  assert.match(homeSource, /saveWorklog/);
  assert.match(homeSource, /브리핑을 불러오지 못했습니다/);
  assert.match(homeSource, /다시 시도/);
  assert.match(homeSource, /BackHandler\.addEventListener/);
  assert.match(homeSource, /setScreen\('home'\)/);
});

test('Authenticated mobile shell is home-first without the duplicated bottom tab bar', () => {
  assert.doesNotMatch(homeSource, /PrimaryNavigation/);
  assert.doesNotMatch(homeSource, /type PrimaryTab/);
  assert.doesNotMatch(homeSource, /screen === 'calendar'/);
  assert.match(homeSource, /accessibilityLabel="과거 업무 검색"/);
  assert.match(homeSource, /accessibilityLabel="설정 열기"/);
  assert.match(homeSource, /오늘과 다가오는 일정/);
  assert.match(homeSource, /\+ 새 일정/);
  assert.match(homeSource, /briefingBuckets\.map/);
  assert.match(homeSource, /tasks\.slice\(0, 3\)/);
  assert.match(homeSource, /개 더 보기/);
  assert.doesNotMatch(homeSource, /quickDockShell|quickDockHeight|setQuickDockHeight/);
  assert.match(homeSource, /quickVoiceFooter/);
  assert.match(homeSource, /<\/ScrollView>[\s\S]*styles\.quickVoiceFooter[\s\S]*VoiceRecorderCard mode="quick"/);
});


test('Calendar and reminder management live under Settings while schedule summaries stay on Home', () => {
  assert.match(homeSource, /일정·알림 관리/);
  assert.match(homeSource, /screen === 'scheduleSettings'/);
  assert.match(homeSource, /휴대폰\/Google Calendar 연결과 일정별 알림을 여기에서 관리합니다/);
  assert.match(homeSource, /showDeviceActions/);
  assert.match(homeSource, /showDeviceStatus/);
  assert.match(homeSource, /compactOnly/);
  assert.doesNotMatch(homeSource, /type PrimaryTab/);
});
