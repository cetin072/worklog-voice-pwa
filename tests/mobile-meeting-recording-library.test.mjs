import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const recorder = fs.readFileSync('mobile/src/features/voice/voice-recorder-card.tsx', 'utf8');
const provider = fs.readFileSync('mobile/src/features/voice/meeting-recording-provider.tsx', 'utf8');
const banner = fs.readFileSync('mobile/src/features/voice/meeting-recording-banner.tsx', 'utf8');
const rootLayout = fs.readFileSync('mobile/app/_layout.tsx', 'utf8');
const library = fs.readFileSync('mobile/src/features/voice/meeting-recording-library.tsx', 'utf8');
const repository = fs.readFileSync('mobile/src/features/voice/meeting-recordings.ts', 'utf8');

test('Meeting recording completion persists an index and survives app re-entry', () => {
  assert.match(provider, /rememberMeetingRecording/);
  assert.match(recorder, /MeetingRecordingLibrary/);
  assert.match(repository, /Paths\.document/);
  assert.match(repository, /meeting-recordings-v1\.json/);
  assert.match(repository, /listMeetingRecordings/);
  assert.match(repository, /fileExists/);
  assert.match(repository, /createdAt/);
  assert.match(repository, /durationMs/);
});

test('Meeting recording library exposes playback, pause, seek and delete', () => {
  assert.match(library, /useAudioPlayer/);
  assert.match(library, /useAudioPlayerStatus/);
  assert.match(library, /player\.play\(\)/);
  assert.match(library, /player\.pause\(\)/);
  assert.match(library, /player\.seekTo/);
  assert.match(library, /15초/);
  assert.match(library, /deleteMeetingRecording/);
  assert.match(library, /최근 회의 녹음/);
  assert.match(library, /새로고침/);
});

test('Meeting recording files stay local-first and are removable from the device', () => {
  assert.match(repository, /new File\(target\.uri\)/);
  assert.match(repository, /file\.delete\(\)/);
  assert.doesNotMatch(repository, /fetch\(|upload|http/i);
  assert.match(provider, /directory: 'document'/);
  assert.match(provider, /allowsBackgroundRecording: true/);
});


test('Meeting recording session survives route-level screen changes and stays visible from Home', () => {
  assert.match(rootLayout, /MeetingRecordingProvider/);
  assert.match(provider, /MeetingRecordingSession/);
  assert.match(provider, /active: phase === 'recording'/);
  assert.match(recorder, /useMeetingRecordingSession/);
  assert.match(banner, /meeting\.active/);
  assert.match(banner, /meeting\.durationMs/);
  assert.match(banner, /회의 녹음 중/);
});


test('Meeting recording library can rename saved recordings for later identification', () => {
  assert.match(repository, /renameMeetingRecording/);
  assert.match(repository, /title: string/);
  assert.match(repository, /title: ''/);
  assert.match(library, /이름 바꾸기/);
  assert.match(library, /회의 녹음 이름/);
  assert.match(library, /이름 저장/);
  assert.match(library, /renameMeetingRecording/);
});


test('Meeting playback restores speaker playback mode after recording', () => {
  assert.match(library, /setAudioModeAsync/);
  assert.match(library, /allowsRecording:\s*false/);
  assert.match(library, /shouldRouteThroughEarpiece:\s*false/);
  assert.match(library, /playsInSilentMode:\s*true/);
});

test('Meeting minutes editor keeps keyboard-visible text fields and save/share actions accessible', () => {
  const editor = library.split('function MeetingMinutesEditor(')[1]?.split('export function MeetingRecordingLibrary(')[0];
  assert.ok(editor, 'meeting editor component must be present');
  assert.match(editor, /<KeyboardAvoidingView[^>]+behavior="padding"/);
  assert.match(editor, /style=\{styles\.minutesScroll\}/);
  assert.match(editor, /keyboardShouldPersistTaps="handled"/);
  assert.match(editor, /keyboardDismissMode="on-drag"/);
  assert.match(editor, /Keyboard\.addListener\('keyboardDidShow'/);
  assert.match(editor, /onFocus=\{\(\) => \{/);
  assert.match(editor, /inputPositions\.current\.transcript/);
  assert.match(editor, /inputPositions\.current\.minutes/);
  assert.match(editor, /placeholderTextColor=\{mobileTheme\.colors\.textMuted\}/);
  const scrollerEnd = editor.indexOf('</ScrollView>');
  const footerStart = editor.indexOf('<View style={styles.minutesFooter}>');
  assert.ok(scrollerEnd > 0 && footerStart > scrollerEnd,
    'Save and share controls must remain outside the scrollable fields and above the IME');
  assert.match(editor.slice(footerStart), /accessibilityLabel="회의록 저장"/);
  assert.match(editor.slice(footerStart), /accessibilityLabel="회의록 공유"/);
  assert.match(library, /minutesKeyboard: \{ flex: 1/);
  assert.match(library, /minutesScroll: \{ flex: 1/);
  assert.match(library, /minutesFooter: \{/);
  const expo = JSON.parse(fs.readFileSync('mobile/app.json', 'utf8'));
  assert.equal(expo.expo.android.softwareKeyboardLayoutMode, 'resize');
});
