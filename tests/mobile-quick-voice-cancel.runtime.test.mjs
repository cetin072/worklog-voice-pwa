import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { nativeComponentHarness, nativeNodes, nativeWords } from './helpers/native-component-harness.mjs';

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

test('the Work input strip shows named actions and leaves the recorder in place while canceling', async () => {
  const { QUICK_VOICE_LAYOUT } = await import('../mobile/src/features/voice/quick-voice-layout.ts');
  const { mobileTheme } = await import('../mobile/src/ui/theme.ts');
  const calls = [];
  const guard = { current: false };
  const h = nativeComponentHarness('mobile/src/features/voice/voice-recorder-card.tsx', 'VoiceRecorderCard', {
    '@/src/features/voice/quick-voice-draft': {},
    '@/src/features/voice/quick-voice-flow': { createQuickVoiceClientRequestId: () => 'draft', quickVoiceNeedsAttention },
    '@/src/features/voice/meeting-recording-library': {},
    '@/src/features/voice/meeting-recording-provider': { useMeetingRecordingSession: () => ({ active: false }) },
    '@/src/features/voice/quick-voice-pcm': { useQuickVoicePcmCapture: () => ({
      start: async () => calls.push('start'), cancel: async () => calls.push('cancel'),
    }) },
    '@/src/features/voice/transcription-provider': {},
    '@/src/features/voice/speech-recognition-session': {},
    '@/src/platform/secure-storage': {},
    '@/src/ui/theme': { mobileTheme },
    '@/src/features/voice/quick-voice-debug': { reportQuickVoiceDebug() {} },
    '@/src/features/voice/quick-voice-layout': { QUICK_VOICE_LAYOUT },
  });
  const props = {
    embedded: true, quickVoice: { draftScope: '' }, navigationGuard: guard, freezeQuickVoiceTimer: true,
    onOpenMeetingRecording: () => calls.push('meeting'), onOpenWorklogInput: () => calls.push('input'),
    renderPhotoAction: disabled => ({ type: 'Photo', props: { disabled } }),
  };
  const render = () => h.render(props);
  const action = label => nativeNodes(render()).find(node => node.props?.accessibilityLabel === label);
  try {
    assert.equal(render().props.style.position, undefined);
    assert.equal(nativeWords(action('업무 직접 입력 열기')).trim(), '직접 입력');
    assert.equal(nativeWords(action('회의 녹음 열기')).trim(), '회의 녹음');
    action('업무 직접 입력 열기').props.onPress();
    action('회의 녹음 열기').props.onPress();
    action('음성 기록 시작').props.onPress();
    await h.effects();
    assert.equal(guard.current, true);
    assert.match(nativeWords(action('음성 기록 종료 후 바로 저장')), /녹음 끝내기/);
    assert.equal(nativeNodes(render()).find(node => node.type === 'Photo').props.disabled, true);
    action('녹음 취소').props.onPress();
    await h.effects();
    assert.equal(guard.current, false);
    assert.deepEqual(calls, ['input', 'meeting', 'start', 'cancel']);
  } finally {
    h.close();
  }
});
