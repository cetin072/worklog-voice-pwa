import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { stripTypeScriptTypes } from 'node:module';

const disk = new Map();
let interruptMove = false;
const Paths = { document: 'file:///worklog' };
class File {
  constructor(...parts) { this.uri = parts.join('/'); }
  get exists() { return disk.has(this.uri); }
  get size() { return this.exists ? Buffer.byteLength(disk.get(this.uri)) : null; }
  create() { if (this.exists) throw Error('exists'); disk.set(this.uri, ''); }
  write(text) { disk.set(this.uri, String(text)); }
  textSync() { if (!this.exists) throw Error('missing'); return disk.get(this.uri); }
  moveSync(to) {
    if (interruptMove) { interruptMove = false; throw Error('simulated move failure'); }
    if (!this.exists || to.exists) throw Error('overwrite refused');
    disk.set(to.uri, disk.get(this.uri));
    disk.delete(this.uri);
    this.uri = to.uri; // Real Expo File.moveSync mutates the file handle.
  }
  delete() { disk.delete(this.uri); }
}
globalThis.__worklogFs = { File, Paths };
const model = await import('../mobile/src/features/voice/meeting-minutes-document.ts');
globalThis.__worklogTranscriptModel = model;
let source = fs.readFileSync('mobile/src/features/voice/meeting-transcript-checkpoint.ts', 'utf8');
for (const [needle, replacement] of [
  ["import { File, Paths } from 'expo-file-system';", 'const { File, Paths } = globalThis.__worklogFs;'],
  ["import { assertMeetingRecordingId } from './meeting-minutes-document';",
    'const { assertMeetingRecordingId } = globalThis.__worklogTranscriptModel;'],
]) {
  assert.equal(source.split(needle).length, 2);
  source = source.replace(needle, replacement);
}
const code = stripTypeScriptTypes(source, { mode: 'strip' });
const storage = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const first = {
  id: 'meeting-20261107132300-recording-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.m4a',
  uri: 'file:///worklog/recording-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.m4a',
  title: '회의', createdAt: '2026-11-07T04:23:00Z',
};
const second = {
  ...first, id: 'meeting-20261107132500-recording-ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee.m4a',
  uri: 'file:///worklog/recording-ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee.m4a',
};
const transcript = {
  schemaVersion: 'v1', text: '회의에서 논의한 안건입니다.',
  segments: [{ index: 0, text: '회의에서 논의한 안건입니다.', startMs: 0, endMs: 3200,
    speakerId: null, confidence: null, sourceAudioRef: { localRef: 'file:///worklog-cache/prepared.wav' } }],
  language: 'ko', provider: 'whisper-rn', model: 'whisper.cpp-base-multilingual',
  providerRequestId: '', durationMs: 18000,
  sourceAudioRef: { localRef: 'file:///worklog-cache/prepared.wav' },
  createdAt: '2026-11-07T04:23:00Z',
};
function reset() { disk.clear(); interruptMove = false; }
const pathFor = (item) => 'file:///worklog/meeting-transcript-' + item.id + '.json';

test('persist a successful raw transcript and reload it after restart; never remove moved file', () => {
  reset();
  disk.set(first.uri, 'SAVED-ORIGINAL-M4A');
  const saved = storage.saveMeetingTranscript(first, transcript);
  assert.equal(saved.transcript.text, transcript.text);
  assert.equal(storage.loadMeetingTranscript(first)?.transcript.text, transcript.text);
  assert.equal(disk.has(pathFor(first)), true);
  assert.equal(disk.get(first.uri), 'SAVED-ORIGINAL-M4A');
  assert.equal(saved.recordingId, first.id);
});

test('retranscription cannot silently overwrite first raw transcript', () => {
  reset();
  const initial = storage.saveMeetingTranscript(first, transcript);
  const repeated = storage.saveMeetingTranscript(first, { ...transcript, text: '다른 STT 결과' });
  assert.deepEqual(repeated, initial);
  assert.equal(storage.loadMeetingTranscript(first)?.transcript.text, transcript.text);
});

test('two recordings remain isolated and a damaged checkpoint is never reset', () => {
  reset();
  storage.saveMeetingTranscript(first, transcript);
  storage.saveMeetingTranscript(second, { ...transcript, text: '다른 회의' });
  assert.equal(storage.loadMeetingTranscript(second)?.transcript.text, '다른 회의');
  assert.equal(storage.loadMeetingTranscript(first)?.transcript.text, transcript.text);
  disk.set(pathFor(first), '{broken checkpoint');
  assert.throws(() => storage.loadMeetingTranscript(first), /원본 파일은 보존/);
  assert.throws(() => storage.saveMeetingTranscript(first, transcript), /원본 파일은 보존/);
  assert.equal(disk.get(pathFor(first)), '{broken checkpoint');
  assert.equal(storage.loadMeetingTranscript(second)?.transcript.text, '다른 회의');
});

test('invalid transcript or failed promotion cannot destroy original audio or claim success', () => {
  reset();
  disk.set(first.uri, 'VOICE-BYTES');
  assert.throws(() => storage.saveMeetingTranscript(first, { ...transcript, text: '' }));
  assert.equal(storage.loadMeetingTranscript(first), null);
  interruptMove = true;
  assert.throws(() => storage.saveMeetingTranscript(first, transcript), /보관을 확인하지 못했습니다/);
  assert.equal(storage.loadMeetingTranscript(first), null);
  assert.equal(disk.get(first.uri), 'VOICE-BYTES');
});
