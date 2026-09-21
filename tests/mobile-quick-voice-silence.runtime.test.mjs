import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('./helpers/mobile-ts-loader.mjs', import.meta.url);

const silence = await import('../mobile/src/features/voice/quick-voice-silence.ts');

const SAMPLE_RATE = 16_000;
const FRAME_MS = silence.QUICK_VOICE_SILENCE_FRAME_MS;
const FRAME_SAMPLES = Math.round(SAMPLE_RATE * FRAME_MS / 1000);

function synthPcm(frameAmplitudes, frequency = 440) {
  const samples = new Int16Array(frameAmplitudes.length * FRAME_SAMPLES);
  let sampleIndex = 0;
  for (const amplitude of frameAmplitudes) {
    for (let index = 0; index < FRAME_SAMPLES; index += 1) {
      const time = sampleIndex / SAMPLE_RATE;
      const value = amplitude <= 0 ? 0 : Math.sin(2 * Math.PI * frequency * time) * amplitude;
      samples[sampleIndex] = Math.round(Math.max(-1, Math.min(1, value)) * 32767);
      sampleIndex += 1;
    }
  }
  return samples.buffer;
}

function frames(count, amplitude) {
  return Array.from({ length: count }, () => amplitude);
}

test('Quick Voice silence compaction trims long leading/trailing silence while protecting speech edges', () => {
  const data = synthPcm([
    ...frames(50, 0),
    ...frames(50, 0.08),
    ...frames(50, 0),
  ]);

  const result = silence.compactQuickVoicePcmSilence(data, SAMPLE_RATE);

  assert.equal(result.originalDurationMs, 3000);
  assert.ok(result.processedDurationMs >= 1300 && result.processedDurationMs <= 1450, String(result.processedDurationMs));
  assert.ok(result.removedSilenceMs >= 1500);
  assert.ok(result.activeSpeechMs >= 980);
  assert.ok(result.data.byteLength < data.byteLength);
});

test('Quick Voice silence compaction shortens a long internal pause but keeps phrase separation', () => {
  const data = synthPcm([
    ...frames(30, 0.08),
    ...frames(100, 0),
    ...frames(30, 0.08),
  ]);

  const result = silence.compactQuickVoicePcmSilence(data, SAMPLE_RATE);

  assert.equal(result.originalDurationMs, 3200);
  assert.ok(result.processedDurationMs >= 1750 && result.processedDurationMs <= 2000, String(result.processedDurationMs));
  assert.ok(result.removedSilenceMs >= 1200);
  assert.ok(result.activeSpeechMs >= 1180);
});

test('Quick Voice silence compaction rejects silence-only input before Whisper', () => {
  const data = synthPcm(frames(100, 0));
  assert.throws(
    () => silence.compactQuickVoicePcmSilence(data, SAMPLE_RATE),
    /말소리가 충분히 감지되지 않았습니다/,
  );
});

test('Quick Voice silence compaction preserves quiet continuous speech instead of mistaking it for noise', () => {
  const data = synthPcm(frames(50, 0.012));
  const result = silence.compactQuickVoicePcmSilence(data, SAMPLE_RATE);

  assert.equal(result.originalDurationMs, 1000);
  assert.equal(result.processedDurationMs, 1000);
  assert.ok(result.activeSpeechMs >= 980);
  assert.ok(result.speechRatio > 0.95);
});
