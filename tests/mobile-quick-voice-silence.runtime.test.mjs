import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('./helpers/mobile-ts-loader.mjs', import.meta.url);

const silence = await import('../mobile/src/features/voice/quick-voice-silence.ts');
const SAMPLE_RATE = 16_000;
const FRAME_SAMPLES = Math.round(SAMPLE_RATE * silence.QUICK_VOICE_SILENCE_FRAME_MS / 1000);

function pcm(frames, frequency = 440) {
  const samples = new Int16Array(frames.length * FRAME_SAMPLES);
  let index = 0;
  for (const amplitude of frames) {
    for (let frameSample = 0; frameSample < FRAME_SAMPLES; frameSample += 1) {
      samples[index] = Math.round(Math.sin(2 * Math.PI * frequency * (index / SAMPLE_RATE)) * amplitude * 32767);
      index += 1;
    }
  }
  return samples.buffer;
}
function repeated(count, amplitude) { return Array.from({ length: count }, () => amplitude); }

test('Whisper fallback trims outer silence but preserves short normal speech', () => {
  const data = pcm([...repeated(50, 0), ...repeated(50, 0.08), ...repeated(50, 0)]);
  const result = silence.compactQuickVoicePcmSilence(data, SAMPLE_RATE);
  assert.equal(result.originalDurationMs, 3000);
  assert.ok(result.processedDurationMs >= 1300 && result.processedDurationMs <= 1450, String(result.processedDurationMs));
  assert.ok(result.removedSilenceMs >= 1500);
  assert.ok(result.data.byteLength < data.byteLength);
});

test('Whisper fallback shortens a long internal pause without joining phrases', () => {
  const data = pcm([...repeated(30, 0.08), ...repeated(100, 0), ...repeated(30, 0.08)]);
  const result = silence.compactQuickVoicePcmSilence(data, SAMPLE_RATE);
  assert.equal(result.originalDurationMs, 3200);
  assert.ok(result.processedDurationMs >= 1750 && result.processedDurationMs <= 2000, String(result.processedDurationMs));
  assert.ok(result.removedSilenceMs >= 1200);
});

test('Whisper fallback keeps a normal short internal pause intact', () => {
  const data = pcm([...repeated(30, 0.08), ...repeated(10, 0), ...repeated(30, 0.08)]);
  const result = silence.compactQuickVoicePcmSilence(data, SAMPLE_RATE);
  assert.equal(result.originalDurationMs, 1400);
  assert.equal(result.processedDurationMs, 1400);
  assert.equal(result.removedSilenceMs, 0);
});

test('Whisper fallback rejects silence-only PCM before native transcription', () => {
  assert.throws(() => silence.compactQuickVoicePcmSilence(pcm(repeated(100, 0)), SAMPLE_RATE), /말소리가 충분히 감지되지 않았습니다/);
});

test('Whisper fallback retains quiet continuous speech', () => {
  const data = pcm(repeated(50, 0.012));
  const result = silence.compactQuickVoicePcmSilence(data, SAMPLE_RATE);
  assert.equal(result.processedDurationMs, 1000);
  assert.equal(result.removedSilenceMs, 0);
});
