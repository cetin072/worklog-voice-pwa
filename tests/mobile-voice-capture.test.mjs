import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(fs.readFileSync('mobile/package.json', 'utf8'));
const appJson = JSON.parse(fs.readFileSync('mobile/app.json', 'utf8'));
const recorderSource = fs.readFileSync('mobile/src/features/voice/voice-recorder-card.tsx', 'utf8');
const audioInputSource = fs.readFileSync('mobile/src/features/voice/audio-input.ts', 'utf8');
const homeSource = fs.readFileSync('mobile/app/index.tsx', 'utf8');

test('Mobile Voice Capture uses Expo SDK 57 audio package', () => {
  assert.equal(packageJson.dependencies['expo-audio'], '57.0.5');
});

test('Expo config enables explicit background recording support', () => {
  const audioPlugin = appJson.expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-audio');
  assert.ok(audioPlugin, 'expo-audio config plugin must exist');
  assert.equal(audioPlugin[1].recordAudioAndroid, true);
  assert.equal(audioPlugin[1].enableBackgroundRecording, true);
  assert.match(audioPlugin[1].microphonePermission, /마이크/);
});

test('Recorder remains local-first and requests required permissions at user action', () => {
  assert.match(recorderSource, /requestRecordingPermissionsAsync/);
  assert.match(recorderSource, /requestNotificationPermissionsAsync/);
  assert.match(recorderSource, /directory:\s*'document'/);
  assert.match(recorderSource, /allowsBackgroundRecording:\s*true/);
  assert.match(recorderSource, /recorder\.pause\(\)/);
  assert.match(recorderSource, /recorder\.stop\(\)/);
});

test('Recording output is adapted to common AudioInput metadata', () => {
  assert.match(audioInputSource, /sourceKind:\s*'mobile-recording'/);
  assert.match(audioInputSource, /durationMs/);
  assert.match(audioInputSource, /mimeType/);
  assert.match(audioInputSource, /createdAt/);
});

test('Authenticated mobile home surfaces the recorder without replacing Data Core smoke paths', () => {
  assert.match(homeSource, /VoiceRecorderCard/);
  assert.match(homeSource, /loadBriefing/);
  assert.match(homeSource, /saveWorklog/);
});

test('Briefing App Shell shows progress plus typed result or error next to the action', () => {
  assert.match(homeSource, /오늘 업무를 불러오는 중/);
  assert.match(homeSource, /briefingBusy/);
  assert.match(homeSource, /MobileBriefing/);
  assert.match(homeSource, /briefingError/);
});

test('Quick voice memo distinguishes device-file completion from worklog registration', () => {
  assert.match(recorderSource, /✅ 음성 메모 파일 저장 완료/);
  assert.match(recorderSource, /업무 기록·브리핑에는 자동 등록되지 않습니다/);
  assert.match(recorderSource, /업무 직접 입력으로 기록하기/);
  assert.match(homeSource, /onOpenWorklogInput=\{\(\) => setScreen\('input'\)\}/);
});
