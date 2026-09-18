import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('mobile/src/features/voice/stt-benchmark.ts', 'utf8');
const executable = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('STT benchmark is provider-neutral and never writes worklog data', () => {
  assert.match(source, /runSttProviderBenchmark/);
  assert.match(source, /MobileTranscriptionProvider/);
  assert.match(source, /transcribeQuickVoice/);
  assert.doesNotMatch(executable, /saveWorklog\s*\(|refreshBriefing\s*\(|scheduleId\s*[:=]/i);
  assert.doesNotMatch(source, /whisper\.rn|sherpa|sensevoice|faster-whisper/i);
});

test('STT benchmark compares the exact same trusted audio across candidates', () => {
  assert.match(source, /candidates: readonly SttBenchmarkCandidate\[\]/);
  assert.match(source, /audio: MobileSttAudioInput/);
  assert.match(source, /transcribeQuickVoice\(candidate\.provider, input\.audio, language\)/);
  assert.match(source, /durationMs: transcript\.durationMs/);
  assert.match(source, /transcribeMs/);
});

test('STT benchmark scores important Korean entity strings without provider-specific logic', () => {
  assert.match(source, /SttBenchmarkEntity/);
  assert.match(source, /normalizeComparableText/);
  assert.match(source, /entityMatches/);
  assert.match(source, /matched:/);
});

test('STT benchmark keeps candidate failures isolated instead of aborting the whole bakeoff', () => {
  assert.match(source, /for \(const candidate of input\.candidates\)/);
  assert.match(source, /ok: false/);
  assert.match(source, /error instanceof Error/);
  assert.match(source, /return Object\.freeze\(results\)/);
});
