import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const adapterPath = 'mobile/src/features/voice/providers/whisper-rn-provider.ts';
const runtimePath = 'mobile/src/features/voice/providers/whisper-rn-runtime.ts';
const source = fs.readFileSync(adapterPath, 'utf8');
const runtime = fs.readFileSync(runtimePath, 'utf8');
const mobilePackage = JSON.parse(fs.readFileSync('mobile/package.json', 'utf8'));

test('whisper.rn stays isolated in a provider adapter and converts Expo PCM16 before transcribeData', () => {
  assert.match(source, /createWhisperRnTranscriptionProvider/);
  assert.match(source, /pcm16LittleEndianToFloat32Buffer/);
  assert.match(source, /new DataView\(data\)/);
  assert.match(source, /new Float32Array\(data\.byteLength \/ 2\)/);
  assert.match(source, /getInt16\(index \* 2, true\) \/ 32_768/);
  assert.match(source, /createConfiguredMobileTranscriptionProvider/);
  assert.match(source, /provider: 'whisper-rn'/);
  assert.match(source, /transcribeData/);
  assert.match(source, /const whisperPcm = pcm16LittleEndianToFloat32Buffer\(audio\.data\)/);
  assert.match(source, /transcribeData\(whisperPcm/);
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
    .map((entry) => path.join(sourceRoot, entry).replaceAll(path.sep, '/'))
    .filter((file) => /['"]whisper\.rn\/index['"]/.test(fs.readFileSync(file, 'utf8')));

  assert.deepEqual(concreteReferences, [runtimePath]);
});

test('release Metro bundle includes whisper.rn\'s explicit buffer polyfill', () => {
  // safe-buffer imports `buffer`, which Metro cannot resolve from Node built-ins.
  assert.equal(mobilePackage.dependencies.buffer, '6.0.3');
});

test('whisper.rn adapter reports model identity through the provider-neutral transcript result', () => {
  assert.match(source, /model: modelId/);
  assert.match(source, /normalizedWhisperResult\([^)]*input\.model\.descriptor\.id/s);
  assert.match(source, /language: result\.language \|\| language/);
  assert.match(source, /result\.isAborted/);
  assert.match(source, /result\.segments/);
  assert.match(source, /segmentText/);
  assert.match(source, /startMs:/);
  assert.match(source, /endMs:/);
});
