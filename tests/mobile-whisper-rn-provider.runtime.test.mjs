import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('./helpers/mobile-ts-loader.mjs', import.meta.url);

const providerModule = await import('../mobile/src/features/voice/providers/whisper-rn-provider.ts');
const inputModule = await import('../mobile/src/features/voice/audio-input.ts');
const transcriptModule = await import('../mobile/src/features/voice/transcription-provider.ts');

const model = {
  descriptor: {
    id: 'whisper-fixture', provider: 'whisper-rn', version: 'fixture', language: 'multilingual', format: 'ggml',
    sha256: 'a'.repeat(64), downloadBytes: null,
  },
  localPath: 'file:///fixture.bin',
};

function fixtureAudio() {
  const pcm16 = new Int16Array([0, 16384, -16384, 32767, -32768]);
  return inputModule.createQuickVoicePcmAudioInput({
    localRef: 'memory://pcm16-fixture', data: pcm16.buffer, sampleRate: 16000, channels: 1,
    durationMs: 1, signal: { peak: 1, rms: 0.4, nonZeroRatio: 0.8 }, createdAt: '2026-09-20T00:00:00Z',
  });
}

function runtimeProvider(result, received) {
  return providerModule.createWhisperRnTranscriptionProvider({
    model,
    context: {
      transcribe() { throw new Error('Quick Voice fixture must use transcribeData'); },
      transcribeData(data, options) {
        received?.push({ data, options });
        return { stop: async () => undefined, promise: Promise.resolve(result) };
      },
    },
  });
}

test('Quick Voice forwards the verified PCM16 ArrayBuffer unchanged to whisper.rn Android data input', async () => {
  const audio = fixtureAudio();
  const received = [];
  const provider = runtimeProvider({ result: '계약서를 확인합니다', language: 'ko', segments: [] }, received);
  const transcript = await transcriptModule.transcribeQuickVoice(provider, audio);

  assert.equal(transcript.text, '계약서를 확인합니다');
  assert.equal(received.length, 1);
  assert.equal(received[0].data, audio.data, 'the native boundary receives the original ArrayBuffer');
  assert.equal(received[0].data.byteLength, audio.data.byteLength, 'PCM16 byte length is not expanded to Float32');
  assert.deepEqual([...new Uint8Array(received[0].data)], [...new Uint8Array(audio.data)]);
  assert.deepEqual(received[0].options, { language: 'ko' });
});

test('Quick Voice normalizes provider result text and segment text through the actual whisper adapter', async () => {
  const provider = runtimeProvider({
    result: '짧은 결과', language: 'ko',
    segments: [{ text: '더 긴 세그먼트 결과', t0: 12, t1: 34 }],
  });
  const transcript = await transcriptModule.transcribeQuickVoice(provider, fixtureAudio());
  assert.equal(transcript.text, '더 긴 세그먼트 결과');
  assert.deepEqual(transcript.segments.map((segment) => ({ text: segment.text, startMs: segment.startMs, endMs: segment.endMs })), [
    { text: '더 긴 세그먼트 결과', startMs: 120, endMs: 340 },
  ]);
});

test('Quick Voice rejects native control-token-only and empty results before persistence', async () => {
  for (const result of ['[_BEG_] [S] ♪', '']) {
    const provider = runtimeProvider({ result, language: 'ko', segments: [] });
    await assert.rejects(() => transcriptModule.transcribeQuickVoice(provider, fixtureAudio()), /사용할 수 있는 전사 문장/);
  }
});
