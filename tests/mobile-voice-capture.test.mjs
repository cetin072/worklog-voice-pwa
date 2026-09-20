import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(fs.readFileSync('mobile/package.json', 'utf8'));
const appJson = JSON.parse(fs.readFileSync('mobile/app.json', 'utf8'));
const recorderSource = fs.readFileSync('mobile/src/features/voice/voice-recorder-card.tsx', 'utf8');
const meetingProviderSource = fs.readFileSync('mobile/src/features/voice/meeting-recording-provider.tsx', 'utf8');
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
  assert.match(meetingProviderSource, /requestRecordingPermissionsAsync/);
  assert.match(meetingProviderSource, /requestNotificationPermissionsAsync/);
  assert.match(meetingProviderSource, /directory:\s*'document'/);
  assert.match(meetingProviderSource, /allowsBackgroundRecording:\s*true/);
  assert.match(meetingProviderSource, /recorder\.pause\(\)/);
  assert.match(meetingProviderSource, /recorder\.stop\(\)/);
});

test('Recording output is adapted to common AudioInput metadata', () => {
  assert.match(audioInputSource, /sourceKind:\s*'mobile-recording'/);
  assert.match(audioInputSource, /durationMs/);
  assert.match(audioInputSource, /mimeType/);
  assert.match(audioInputSource, /createdAt/);
  assert.match(audioInputSource, /QuickVoicePcmSignal/);
  assert.match(audioInputSource, /signal:/);
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

test('Quick voice memo uses the home bottom dock and auto-saves a valid STT transcript', () => {
  assert.match(recorderSource, /useQuickVoicePcmCapture/);
  assert.match(recorderSource, /transcribeQuickVoiceCapture/);
  assert.match(recorderSource, /createQuickVoiceSaveAttempt/);
  assert.match(recorderSource, /const saved = await saveAttempt\.current\.save\(\)/);
  assert.doesNotMatch(recorderSource, /전사문을 확인한 뒤 저장하세요/);
  assert.doesNotMatch(recorderSource, /runQuickVoiceFastPath/);
  assert.match(recorderSource, /quickDock/);
  assert.match(recorderSource, /quickMic/);
  assert.match(recorderSource, /녹음 중/);
  assert.match(recorderSource, /quickMicTimer/);
  assert.match(recorderSource, /브리핑 카드의 ✏️/);
  assert.match(recorderSource, /업무 저장 완료/);
  assert.match(recorderSource, /업무 직접 입력 열기/);
  assert.match(homeSource, /<View pointerEvents="box-none" onLayout=\{/);
  assert.match(homeSource, /styles\.quickDockShell/);
  assert.match(recorderSource, /return <View pointerEvents="box-none" style=\{styles\.quickDock\}>/);
  assert.match(homeSource, /prepareQuickVoiceWhisperProvider/);
  assert.match(homeSource, /saveWorklog: async \(transcript, options\)/);
  assert.match(homeSource, /refreshBriefing/);
});


test('Meeting recorder is owned by an app-wide session instead of the meeting card lifecycle', () => {
  const rootLayout = fs.readFileSync('mobile/app/_layout.tsx', 'utf8');
  const banner = fs.readFileSync('mobile/src/features/voice/meeting-recording-banner.tsx', 'utf8');
  assert.match(rootLayout, /MeetingRecordingProvider/);
  assert.match(recorderSource, /useMeetingRecordingSession/);
  assert.doesNotMatch(recorderSource, /useAudioRecorder\(/);
  assert.match(banner, /진행 중인 회의 녹음으로 돌아가기/);
  assert.match(homeSource, /MeetingRecordingBanner onOpen=\{\(\) => setScreen\('meeting'\)\}/);
});


test('Home reserves measured space for the variable-height Quick Voice dock', () => {
  assert.match(homeSource, /quickDockHeight/);
  assert.match(homeSource, /onLayout=\{\(event\) => setQuickDockHeight/);
  assert.match(homeSource, /quickDockHeight \+ 32/);
});

test('Quick Voice keeps a separate top control and left-center-right orbital controls with explicit cancellation', () => {
  assert.match(recorderSource, /quickTopControl/);
  assert.match(recorderSource, /quickOrbitalRow/);
  assert.match(recorderSource, /quickPrimaryControl/);
  assert.match(recorderSource, /quickAuxiliaryAction/);
  assert.match(recorderSource, /quickAuxiliaryStatus/);
  assert.match(recorderSource, /QUICK_VOICE_LAYOUT/);
  assert.match(recorderSource, /horizontalGap/);
  assert.doesNotMatch(recorderSource, /marginTop: -28/);
  assert.doesNotMatch(recorderSource, /quickAuxiliaryControls/);
  assert.match(recorderSource, /accessibilityLabel="녹음 취소"/);
  assert.match(recorderSource, /cancelQuickVoice/);
  assert.match(recorderSource, /quickMicActive: \{ backgroundColor: '#b91c1c'/);
  assert.match(recorderSource, /recordingElapsedMs/);
  assert.match(recorderSource, /● 녹음 중 ·/);
  assert.match(recorderSource, /quickMicTimer/);
  assert.match(recorderSource, /끝나면 빨간 버튼을 누르세요/);
  assert.match(homeSource, /Math\.max\(220, Math\.ceil\(event\.nativeEvent\.layout\.height\)\)/);
});
