import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(
  'mobile/src/features/voice/providers/whisper-rn-provider.ts',
  'utf8',
);

test('whisper.rn stays isolated in a provider adapter and consumes raw PCM through transcribeData', () => {
  assert.match(source, /createWhisperRnTranscriptionProvider/);
  assert.match(source, /createConfiguredMobileTranscriptionProvider/);
  assert.match(source, /provider: 'whisper-rn'/);
  assert.match(source, /transcribeData/);
  assert.match(source, /audio\.data/);
  assert.match(source, /16_000/);
  assert.match(source, /audio\.channels !== 1/);
  assert.match(source, /audio\.encoding !== 'int16'/);
});

test('whisper.rn concrete package import does not leak into the adapter contract', () => {
  assert.doesNotMatch(source, /from ['"]whisper\.rn/);
  assert.match(source, /WhisperRnContextLike/);
  assert.match(source, /ResolvedSttModel/);
});

test('whisper.rn adapter reports model identity through the provider-neutral transcript result', () => {
  assert.match(source, /model: input\.model\.descriptor\.id/);
  assert.match(source, /language: result\.language \|\| language/);
  assert.match(source, /result\.isAborted/);
});
