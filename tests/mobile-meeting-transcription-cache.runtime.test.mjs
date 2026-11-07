import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { stripTypeScriptTypes } from 'node:module';

const cache = new Map();
const Paths = { cache: { uri: 'file:///worklog-cache/' } };
class File {
  constructor(uri) { this.uri = uri; }
  get exists() { return cache.has(this.uri); }
  delete() { cache.delete(this.uri); }
}

let persisted = null;
let calls = 0;
let saveFailure = false;
let preparedUri = 'file:///worklog-cache/meeting-stt-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.wav';
globalThis.__meetingCacheTest = {
  native: { File, Paths },
  transcript: {
    async transcribeMeetingRecording() {
      calls++;
      return {
        transcript: { text: '회의 전사 원문' },
        checkpoint: { preparedUri },
        timings: { preprocessMs: 14, transcribeMs: 200 },
      };
    },
  },
  storage: {
    loadMeetingTranscript() { return persisted; },
    saveMeetingTranscript() {
      if (saveFailure) throw Error('simulated checkpoint failure');
      persisted = { transcript: { text: '회의 전사 원문' } };
      return persisted;
    },
  },
};

let source = fs.readFileSync('mobile/src/features/voice/meeting-transcription-checkpoint-flow.ts', 'utf8');
const pairs = [
  ["import { File, Paths } from 'expo-file-system';",
    "const { File, Paths } = globalThis.__meetingCacheTest.native;"],
  [/import \{[\s\S]*?\} from '\.\/meeting-transcription-flow';/,
    "const { transcribeMeetingRecording } = globalThis.__meetingCacheTest.transcript;"],
  [/import \{[\s\S]*?\} from '\.\/meeting-transcript-checkpoint';/,
    "const { loadMeetingTranscript, saveMeetingTranscript } = globalThis.__meetingCacheTest.storage;"],
];
for (const [from, into] of pairs) {
  if (typeof from === 'string') assert.equal(source.split(from).length, 2);
  else assert.equal([...source.matchAll(new RegExp(from.source, 'g'))].length, 1);
  source = source.replace(from, into);
}
const code = stripTypeScriptTypes(source, { mode: 'strip' });
const implementation = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const recording = {
  id: 'meeting-20261107123000-recording-ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee.m4a',
  uri: 'file:///worklog/recording-ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee.m4a',
};
function reset() { cache.clear(); persisted = null; calls = 0; saveFailure = false;
  preparedUri = 'file:///worklog-cache/meeting-stt-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.wav'; }

test('successful transcript checkpoint reuses original M4A and removes only owned cache WAV', async () => {
  reset();
  cache.set(recording.uri, 'ORIGINAL_M4A_BYTES');
  cache.set(preparedUri, 'DERIVED_WAV_BYTES');
  const result = await implementation.ensureMeetingTranscript({ recording, preprocessor: {}, provider: {} });
  assert.equal(result.reused, false);
  assert.equal(result.checkpoint.transcript.text, '회의 전사 원문');
  assert.equal(cache.has(preparedUri), false);
  assert.equal(cache.get(recording.uri), 'ORIGINAL_M4A_BYTES');
  assert.equal(calls, 1);
});

test('existing successful transcript never reruns the expensive decoder or STT', async () => {
  reset();
  persisted = { transcript: { text: '이미 저장된 전사문' } };
  cache.set(preparedUri, 'UNRELATED_PREPARED_WAV');
  const result = await implementation.ensureMeetingTranscript({ recording, preprocessor: {}, provider: {} });
  assert.equal(result.reused, true);
  assert.equal(calls, 0);
  assert.equal(cache.get(preparedUri), 'UNRELATED_PREPARED_WAV');
});

test('checkpoint save failure leaves original recording and prepared WAV for retry', async () => {
  reset(); saveFailure = true;
  cache.set(recording.uri, 'VOICE_ORIGINAL');
  cache.set(preparedUri, 'PREPARED_WAV');
  await assert.rejects(() => implementation.ensureMeetingTranscript({
    recording, preprocessor: {}, provider: {},
  }), /simulated checkpoint failure/);
  assert.equal(cache.get(recording.uri), 'VOICE_ORIGINAL');
  assert.equal(cache.get(preparedUri), 'PREPARED_WAV');
});

test('unknown cache WAV and any recording URI cannot be erased by successful STT', async () => {
  reset();
  preparedUri = 'file:///worklog-cache/not-our-original.wav';
  cache.set(preparedUri, 'UNRELATED_USER_FILE');
  cache.set(recording.uri, 'USER_M4A');
  await implementation.ensureMeetingTranscript({ recording, preprocessor: {}, provider: {} });
  assert.equal(cache.get(preparedUri), 'UNRELATED_USER_FILE');
  assert.equal(cache.get(recording.uri), 'USER_M4A');
});
