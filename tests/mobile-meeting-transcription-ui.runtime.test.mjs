import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

let stored = null;
let nativeAvailable = false;
let nativeCalls = 0;
let sttCalls = 0;
let prepareResult = null;
let prepareError = null;

globalThis.__meetingUiTest = {
  storage: {
    loadMeetingTranscript() { return stored; },
  },
  native: {
    createAndroidMeetingAudioPreprocessor() {
      nativeCalls++;
      return { configured: nativeAvailable };
    },
  },
  runtime: {
    async prepareRecordedMeetingTranscript(recording, onModelDownload) {
      sttCalls++;
      if (onModelDownload) onModelDownload(10, 100);
      if (prepareError) throw prepareError;
      return prepareResult ?? {
        checkpoint: {
          recordingId: recording.id,
          transcript: { text: '검증된 자동 전사문' },
        },
        reused: false,
      };
    },
  },
};

let rawSource = readFileSync('mobile/src/features/voice/meeting-transcription-ui.ts', 'utf8');
for (const [from, to] of [
  [/import \{[\s\S]*?\} from '\.\/meeting-transcript-checkpoint';/,
    'const { loadMeetingTranscript } = globalThis.__meetingUiTest.storage;'],
  [/import \{[\s\S]*?\} from '\.\/providers\/android-meeting-audio-preprocessor';/,
    'const { createAndroidMeetingAudioPreprocessor } = globalThis.__meetingUiTest.native;'],
  [/import \{[\s\S]*?\} from '\.\/providers\/meeting-transcription-runtime';/,
    'const { prepareRecordedMeetingTranscript } = globalThis.__meetingUiTest.runtime;'],
]) {
  assert.equal([...rawSource.matchAll(new RegExp(from.source, 'g'))].length, 1);
  rawSource = rawSource.replace(from, to);
}
const compiled = stripTypeScriptTypes(rawSource, { mode: 'strip' });
async function importForVariant(variant, key) {
  const prior = process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT;
  if (variant === null) delete process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT;
  else process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT = variant;
  try {
    const url = 'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64') + '#' + key;
    return await import(url);
  } finally {
    if (prior === undefined) delete process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT;
    else process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT = prior;
  }
}
const meeting = { id: 'meeting-20261107000000-recording-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.m4a' };
function reset() {
  stored = null;
  nativeAvailable = false;
  nativeCalls = 0;
  sttCalls = 0;
  prepareResult = null;
  prepareError = null;
}

test('production build cannot show or invoke unverified on-device transcription', async () => {
  reset();
  const production = await importForVariant('production', 'production');
  assert.equal(production.MEETING_TRANSCRIPTION_QA_ONLY, false);
  assert.equal(production.canStartMeetingTranscription(), false);
  assert.equal(nativeCalls, 0);
  await assert.rejects(() => production.transcribeMeetingForQa({ recording: meeting }), /정식 앱/);
  assert.equal(sttCalls, 0);
});

test('QA build requires real native audio module; existing QA APK fails closed', async () => {
  reset();
  const qa = await importForVariant('qa', 'qa-no-native');
  assert.equal(qa.MEETING_TRANSCRIPTION_QA_ONLY, true);
  assert.equal(qa.canStartMeetingTranscription(), false);
  await assert.rejects(() => qa.transcribeMeetingForQa({ recording: meeting }), /Android 모듈/);
  assert.equal(sttCalls, 0);
});

test('QA loads existing raw checkpoint without native module or model download', async () => {
  reset();
  const qa = await importForVariant('qa', 'qa-cached');
  stored = { recordingId: meeting.id, transcript: { text: '다시 읽은 원시 전사문' } };
  const got = await qa.transcribeMeetingForQa({ recording: meeting });
  assert.equal(got.reused, true);
  assert.equal(got.checkpoint, stored);
  assert.equal(nativeCalls, 0);
  assert.equal(sttCalls, 0);
  assert.equal(qa.readSavedMeetingTranscript(meeting), stored);
});

test('QA prepares and transcribes only on explicit action, passing model progress', async () => {
  reset();
  const qa = await importForVariant('qa', 'qa-ready');
  nativeAvailable = true;
  assert.equal(qa.canStartMeetingTranscription(), true);
  assert.equal(sttCalls, 0, 'no UI effect may silently start native STT');
  const seen = [];
  const got = await qa.transcribeMeetingForQa({
    recording: meeting,
    onModelDownload(bytes, total) { seen.push([bytes, total]); },
  });
  assert.equal(got.reused, false);
  assert.equal(got.checkpoint.transcript.text, '검증된 자동 전사문');
  assert.deepEqual(seen, [[10, 100]]);
  assert.equal(sttCalls, 1);
});

test('transcription failure never fabricates a saved result', async () => {
  reset();
  const qa = await importForVariant('qa', 'qa-failed');
  nativeAvailable = true;
  prepareError = new Error('M4A 디코드 실패');
  await assert.rejects(() => qa.transcribeMeetingForQa({ recording: meeting }), /M4A 디코드 실패/);
  assert.equal(sttCalls, 1);
  assert.equal(stored, null);
});

test('UI isolates raw transcript from manual minutes and requires explicit import confirmation', () => {
  const ui = readFileSync('mobile/src/features/voice/meeting-recording-library.tsx', 'utf8');
  const editor = ui.split('function MeetingMinutesEditor(')[1]?.split('export function MeetingRecordingLibrary(')[0];
  assert.ok(editor);
  assert.match(editor, /MEETING_TRANSCRIPTION_QA_ONLY \?/);
  assert.match(editor, /canStartMeetingTranscription\(\)/);
  assert.match(editor, /onPress=\{\(\) => void startQaTranscription\(\)\}/);
  assert.match(editor, /transcriptionInFlight\.current/);
  assert.match(editor, /readSavedMeetingTranscript\(recording\)/);
  assert.match(editor, /setRawTranscript\(result\.checkpoint\)/);
  assert.match(editor, /transcribeMeetingForQa\(\{/);
  assert.match(editor, /rawTranscript\.transcript\.text\.slice\(0, 1200\)/);
  assert.match(editor, /transcriptText\.trim\(\) && transcriptText !== text/);
  assert.match(editor, /Alert\.alert\('기존 녹취문 입력'/);
  assert.match(editor, /setTranscriptText\(text\)/);
  assert.match(editor, /검토 후 저장을 눌러주세요/);
  assert.match(editor, /text\.length > 120000/);
  assert.match(editor, /checkpointDamaged/);
  assert.match(editor, /onPress=\{importRawTranscript\}/);
  assert.match(editor, /setMinutesText\(value\)/);
  assert.match(editor, /saveMeetingMinutes\(\{ recordingId: recording\.id, transcriptText, minutesText, expectedPrevious: saved \}\)/);
  assert.doesNotMatch(editor, /setMinutesText\(result\.checkpoint|saveMeetingMinutes\(result\./);
});
