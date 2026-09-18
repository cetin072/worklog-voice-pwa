import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('mobile/src/features/voice/quick-voice-pcm.ts', 'utf8');

test('Quick Voice PCM requests the Whisper-friendly format through existing Expo AudioStream', () => {
  assert.match(source, /useAudioStream/);
  assert.match(source, /QUICK_VOICE_PCM_SAMPLE_RATE = 16_000/);
  assert.match(source, /QUICK_VOICE_PCM_CHANNELS = 1/);
  assert.match(source, /QUICK_VOICE_PCM_ENCODING = 'int16'/);
  assert.match(source, /onBuffer\(buffer: AudioStreamBuffer\)/);
  assert.match(source, /buffer\.data/);
});

test('Quick Voice PCM verifies actual device sample rate and channels instead of trusting requested options', () => {
  assert.match(source, /buffer\.sampleRate/);
  assert.match(source, /buffer\.channels/);
  assert.match(source, /stream\.stream\.sampleRate/);
  assert.match(source, /stream\.stream\.channels/);
  assert.match(source, /assertQuickVoicePcmFormat/);
  assert.match(source, /16kHz PCM이 필요합니다/);
  assert.match(source, /mono PCM이 필요합니다/);
});

test('Quick Voice PCM bounds in-memory capture and derives duration from actual PCM bytes', () => {
  assert.match(source, /MAX_CAPTURE_BYTES/);
  assert.match(source, /overflowed/);
  assert.match(source, /bytesPerSample = 2/);
  assert.match(source, /samplesPerChannel/);
  assert.match(source, /durationMs/);
});

test('Quick Voice PCM remains foreground-only and permission-gated for the short memo path', () => {
  assert.match(source, /requestRecordingPermissionsAsync/);
  assert.match(source, /allowsBackgroundRecording: false/);
  assert.match(source, /stream\.stream\.start\(\)/);
  assert.match(source, /stream\.stream\.stop\(\)/);
});
