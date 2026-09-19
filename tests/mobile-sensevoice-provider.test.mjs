import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('mobile/src/features/voice/providers/sensevoice-provider.ts', 'utf8');
const core = fs.readFileSync('mobile/src/features/voice/transcription-provider.ts', 'utf8');
const flow = fs.readFileSync('mobile/src/features/voice/quick-voice-flow.ts', 'utf8');
const home = fs.readFileSync('mobile/app/index.tsx', 'utf8');

test('SenseVoice stays behind the common MobileTranscriptionProvider boundary', () => {
  assert.match(source, /createSenseVoiceTranscriptionProvider/);
  assert.match(source, /createConfiguredMobileTranscriptionProvider/);
  assert.match(source, /provider: 'sherpa-onnx'/);
  assert.match(source, /SenseVoiceRuntimeLike/);
});

test('SenseVoice boundary consumes the existing trusted 16k mono PCM contract', () => {
  assert.match(source, /audio\.sourceKind !== 'quick-voice-pcm'/);
  assert.match(source, /audio\.sampleRate !== 16_000/);
  assert.match(source, /audio\.channels !== 1/);
  assert.match(source, /audio\.encoding !== 'int16'/);
  assert.match(source, /runtime\.transcribePcm16/);
  assert.match(source, /data: audio\.data/);
});

test('Core, flow and Home do not import sherpa or SenseVoice native types', () => {
  for (const text of [core, flow, home]) {
    assert.doesNotMatch(text, /sensevoice-provider|sherpa-onnx|SenseVoiceRuntimeLike/);
  }
});

test('SenseVoice provider validates its model identity before runtime use', () => {
  assert.match(source, /input\.model\.descriptor\.provider !== 'sherpa-onnx'/);
  assert.match(source, /model: input\.model\.descriptor\.id/);
});
