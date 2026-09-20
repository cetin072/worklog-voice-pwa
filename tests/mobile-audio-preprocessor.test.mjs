import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const audioInput = fs.readFileSync('mobile/src/features/voice/audio-input.ts', 'utf8');
const preprocessor = fs.readFileSync('mobile/src/features/voice/audio-preprocessor.ts', 'utf8');
const transcription = fs.readFileSync('mobile/src/features/voice/transcription-provider.ts', 'utf8');
const whisper = fs.readFileSync('mobile/src/features/voice/providers/whisper-rn-provider.ts', 'utf8');

test('Meeting/call audio preprocessing preserves the original recording and returns a derived PCM WAV contract', () => {
  assert.match(audioInput, /PreparedPcmFileAudioInput/);
  assert.match(audioInput, /sourceKind: 'prepared-pcm-file'/);
  assert.match(audioInput, /mimeType: 'audio\/wav'/);
  assert.match(audioInput, /encoding: 'pcm16-wav'/);
  assert.match(preprocessor, /prepareRecordingForStt/);
  assert.match(preprocessor, /The original recording is never replaced or deleted here/);
});

test('Audio preprocessing remains replaceable behind a generic adapter boundary', () => {
  assert.match(preprocessor, /MobileAudioPreprocessor/);
  assert.match(preprocessor, /service: 'audio-preprocess'/);
  assert.match(preprocessor, /operation: 'prepare-stt'/);
  assert.match(preprocessor, /createConfiguredMobileAudioPreprocessor/);
  assert.match(preprocessor, /createUnconfiguredMobileAudioPreprocessor/);
});

test('Transcription core accepts prepared audio without importing a concrete decoder', () => {
  assert.match(transcription, /transcribeMobileAudio/);
  assert.match(transcription, /prepared-pcm-file/);
  assert.doesNotMatch(transcription, /MediaCodec|MediaExtractor|ffmpeg|sherpa|whisper\.rn/);
});

test('Whisper Android file transcription fails closed for original M4A and accepts only prepared PCM WAV', () => {
  assert.match(whisper, /audio\.sourceKind === 'mobile-recording'/);
  assert.match(whisper, /회의 녹음을 먼저 STT용 WAV로 전처리해주세요/);
  assert.match(whisper, /audio\.sourceKind === 'prepared-pcm-file'/);
  assert.match(whisper, /audio\.mimeType !== 'audio\/wav'/);
  assert.match(whisper, /audio\.encoding !== 'pcm16-wav'/);
  assert.match(whisper, /input\.context\.transcribe\(audio\.uri/);
});

test('Quick Voice preserves PCM16 bytes for native decode beside prepared file transcription', () => {
  assert.match(whisper, /decodePcm16\(\)/);
  assert.doesNotMatch(whisper, /pcm16LittleEndianToFloat32Buffer/);
  assert.match(whisper, /input\.context\.transcribeData/);
  assert.match(whisper, /transcribeData\(audio\.data/);
  assert.match(whisper, /16kHz mono int16 PCM/);
});


test('Long-audio preprocessing uses derived file checkpoints instead of replacing the source', () => {
  assert.match(preprocessor, /PreparedAudioCheckpoint/);
  assert.match(preprocessor, /createPreparedAudioCheckpoint/);
  assert.match(preprocessor, /result\.uri === recording\.uri/);
  assert.match(preprocessor, /prepared\.uri === recording\.uri/);
  assert.match(preprocessor, /원본 회의 녹음/);
  assert.doesNotMatch(preprocessor, /ArrayBuffer/);
});
