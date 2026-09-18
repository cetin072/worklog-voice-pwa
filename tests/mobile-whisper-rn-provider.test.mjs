import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const adapterPath = 'mobile/src/features/voice/providers/whisper-rn-provider.ts';
const runtimePath = 'mobile/src/features/voice/providers/whisper-rn-runtime.ts';
const source = fs.readFileSync(adapterPath, 'utf8');
const runtime = fs.readFileSync(runtimePath, 'utf8');

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

test('only the provider composition runtime references the concrete whisper.rn package', () => {
  assert.doesNotMatch(source, /whisper\.rn\/index/);
  assert.match(runtime, /require\('whisper\.rn\/index'\)/);
  assert.match(runtime, /initializeWhisperRnRuntime/);

  const sourceRoot = 'mobile/src';
  const concreteReferences = fs.readdirSync(sourceRoot, { recursive: true })
    .filter((entry) => typeof entry === 'string' && /\.tsx?$/.test(entry))
    .map((entry) => path.join(sourceRoot, entry))
    .filter((file) => /['"]whisper\.rn\/index['"]/.test(fs.readFileSync(file, 'utf8')));

  assert.deepEqual(concreteReferences, [runtimePath]);
});

test('whisper.rn adapter reports model identity through the provider-neutral transcript result', () => {
  assert.match(source, /model: input\.model\.descriptor\.id/);
  assert.match(source, /language: result\.language \|\| language/);
  assert.match(source, /result\.isAborted/);
});
