import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const homeSource = fs.readFileSync('mobile/app/index.tsx', 'utf8');
const apiSource = fs.readFileSync('mobile/src/platform/worklog-api.ts', 'utf8');
const recorderSource = fs.readFileSync('mobile/src/features/voice/voice-recorder-card.tsx', 'utf8');

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
  assert.match(recorderSource, /mode === 'meeting'/);
  assert.doesNotMatch(homeSource, /WebView/);
});

test('Mobile shell provides direct entry, recovery states, and Android back navigation', () => {
  assert.match(homeSource, /saveWorklog/);
  assert.match(homeSource, /브리핑을 불러오지 못했습니다/);
  assert.match(homeSource, /다시 시도/);
  assert.match(homeSource, /BackHandler\.addEventListener/);
  assert.match(homeSource, /setScreen\('home'\)/);
});
