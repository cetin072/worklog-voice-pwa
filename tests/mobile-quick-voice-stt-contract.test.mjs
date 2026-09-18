import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('mobile/src/features/voice/transcription-provider.ts', 'utf8');
const audioInput = fs.readFileSync('mobile/src/features/voice/audio-input.ts', 'utf8');

test('Quick Voice STT contract stays provider-neutral behind an explicit stt/transcribe boundary', () => {
  assert.match(source, /service: 'stt'/);
  assert.match(source, /operation: 'transcribe'/);
  assert.match(source, /createConfiguredMobileTranscriptionProvider/);
  assert.match(source, /createUnconfiguredMobileTranscriptionProvider/);
  assert.match(source, /transcribeQuickVoice/);
  assert.doesNotMatch(source, /whisper\.rn|sherpa|faster-whisper|openai|clova/i);
});

test('Quick Voice transcript inherits trusted file or PCM evidence instead of provider-spoofed references', () => {
  assert.match(source, /MobileSttAudioInput/);
  assert.match(source, /audio\.sourceKind === 'mobile-recording'/);
  assert.match(source, /audio\.data instanceof ArrayBuffer/);
  assert.match(source, /trustedAudioLocalRef\(audio\)/);
  assert.match(source, /sourceAudioRef: Object\.freeze\(\{ localRef \}\)/);
  assert.match(source, /durationMs: Math\.max\(0, Math\.round\(audio\.durationMs\)\)/);
  assert.match(source, /createdAt: new Date\(audio\.createdAt\)\.toISOString\(\)/);

  assert.match(audioInput, /sourceKind: 'quick-voice-pcm'/);
  assert.match(audioInput, /createQuickVoicePcmAudioInput/);
  assert.match(audioInput, /trustedAudioLocalRef/);
});

test('Quick Voice transcript keeps Transcript V1-compatible text, segments, language, provider, and model fields', () => {
  for (const token of ['schemaVersion', 'segments', 'startMs', 'endMs', 'speakerId', 'confidence', 'language', 'provider', 'model', 'providerRequestId']) {
    assert.match(source, new RegExp(token));
  }
  assert.match(source, /schemaVersion: 'v1'/);
  assert.match(source, /'ko'/);
});

test('Quick Voice STT fails closed for unconfigured adapters and invalid transcript data', () => {
  assert.match(source, /if \(!provider\.configured\)/);
  assert.match(source, /음성에서 사용할 수 있는 전사 문장을 찾지 못했습니다/);
  assert.match(source, /종료시각이 시작시각보다 빠릅니다/);
  assert.match(source, /confidence가 올바르지 않습니다/);
});


test('Quick Voice rejects Whisper special-token-only text before canonical save', () => {
  assert.match(source, /normalizeTranscriptText/);
  assert.match(source, /BLANK_AUDIO/);
  assert.match(source, /SILENCE/);
  assert.match(source, /\[\(\?:S\|BLANK_AUDIO/);
});
