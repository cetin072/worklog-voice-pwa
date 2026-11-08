import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ts = createRequire(new URL('../mobile/package.json', import.meta.url))('typescript');
const src = readFileSync('mobile/src/features/voice/meeting-recording-provider.tsx', 'utf8');
const ast = ts.createSourceFile('provider.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let declaration = '';
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'stop') declaration = node.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(declaration, 'real MeetingRecordingProvider.stop must be tested');

function harness({ audioResetFails = false, indexFails = false } = {}) {
  const calls = [];
  const state = { completed: null, phase: 'recording', libraryVersion: 5, error: '' };
  const recorded = {
    uri: 'file:///app/recording-11111111-1111-4111-8111-111111111111.m4a',
    mimeType: 'audio/mp4',
    fileName: 'recording-11111111-1111-4111-8111-111111111111.m4a',
    durationMs: 123456,
    createdAt: '2026-11-08T09:00:00.000Z',
  };
  const scope = {
    phase: 'recording',
    stopping: { current: false }, recordingOwner: { current: 'account-a' },
    recorder: {
      uri: recorded.uri,
      async stop() { calls.push('stop'); },
      async getStatus() { calls.push('status'); return { durationMillis: recorded.durationMs }; },
    },
    recorderState: { durationMillis: recorded.durationMs },
    startedAt: recorded.createdAt,
    setError(v) { state.error = v; },
    setPhase(v) { state.phase = v; },
    setStartedAt(v) { state.startedAt = v; },
    setCompleted(v) { state.completed = v; },
    setLibraryVersion(update) { state.libraryVersion = update(state.libraryVersion); },
    createMobileRecordingAudioInput(input) { calls.push('normalize'); return { ...recorded, ...input }; },
    rememberMeetingRecording(value) {
      calls.push('index');
      if (indexFails) throw new Error('index unavailable');
      assert.equal(value.uri, recorded.uri);
    },
    async setAudioModeAsync() {
      calls.push('audio-mode-off');
      if (audioResetFails) throw new Error('Android audio mode unavailable');
    },
    messageOf(e) { return e.message; },
  };
  const js = ts.transpileModule(declaration, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const stop = new Function('scope', 'with(scope) { ' + js + '; return stop; }')(scope);
  return { stop, calls, state, recorded };
}

test('post-save audio-mode failure cannot turn confirmed M4A + index into a false save failure', async () => {
  const h = harness({ audioResetFails: true });
  await h.stop();
  assert.deepEqual(h.calls, ['stop', 'status', 'normalize', 'index', 'audio-mode-off']);
  assert.equal(h.state.phase, 'idle');
  assert.equal(h.state.libraryVersion, 6);
  assert.equal(h.state.completed.uri, h.recorded.uri);
  assert.match(h.state.error, /기기에 저장됐습니다/);
  assert.doesNotMatch(h.state.error, /종료하지 못했습니다|저장하지 못했습니다/);
});

test('failed index write is never falsely reported as a completed local recording', async () => {
  const h = harness({ indexFails: true });
  await h.stop();
  assert.deepEqual(h.calls, ['stop', 'status', 'normalize', 'index']);
  assert.equal(h.state.phase, 'idle');
  assert.equal(h.state.completed, null);
  assert.equal(h.state.libraryVersion, 5);
  assert.match(h.state.error, /index unavailable/);
});
