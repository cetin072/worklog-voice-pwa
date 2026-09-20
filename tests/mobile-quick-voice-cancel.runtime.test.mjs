import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { cancelQuickVoiceCapture } = await import('../mobile/src/features/voice/quick-voice-capture-lifecycle.ts');
const { quickVoiceNeedsAttention } = await import('../mobile/src/features/voice/quick-voice-flow.ts');

test('recording cancellation stops capture, restores audio mode, discards chunks, and returns to an unguarded idle transition', async () => {
  const calls = [];
  await cancelQuickVoiceCapture({
    stopCapture: async () => { calls.push('stop'); },
    disableRecordingMode: async () => { calls.push('audio-mode-off'); },
    discardCapturedAudio: () => { calls.push('discard'); },
  });
  assert.deepEqual(calls, ['stop', 'audio-mode-off', 'discard']);
  assert.equal(quickVoiceNeedsAttention('idle'), false);
});

test('recording cancellation still disables audio mode and discards chunks if stopping capture fails', async () => {
  const calls = [];
  await assert.rejects(() => cancelQuickVoiceCapture({
    stopCapture: async () => { calls.push('stop'); throw new Error('stop failed'); },
    disableRecordingMode: async () => { calls.push('audio-mode-off'); },
    discardCapturedAudio: () => { calls.push('discard'); },
  }), /stop failed/);
  assert.deepEqual(calls, ['stop', 'audio-mode-off', 'discard']);
});
