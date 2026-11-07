import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const base = 'mobile/modules/worklog-meeting-audio';
const kotlin = fs.readFileSync(base + '/android/src/main/java/expo/modules/worklogmeetingaudio/WorklogMeetingAudioModule.kt', 'utf8');
const config = JSON.parse(fs.readFileSync(base + '/expo-module.config.json', 'utf8'));
const adapter = fs.readFileSync('mobile/src/features/voice/providers/android-meeting-audio-preprocessor.ts', 'utf8');
const compose = fs.readFileSync('mobile/src/features/voice/providers/meeting-transcription-runtime.ts', 'utf8');
const stt = fs.readFileSync('mobile/src/features/voice/meeting-transcription-checkpoint-flow.ts', 'utf8');

test('Android module builds inside the existing Expo app, with no new decoding dependency', () => {
  assert.deepEqual(config.platforms, ['android']);
  assert.deepEqual(config.android.modules, ['expo.modules.worklogmeetingaudio.WorklogMeetingAudioModule']);
  assert.match(kotlin, /Name\("WorklogMeetingAudio"\)/);
  assert.match(kotlin, /AsyncFunction\("prepareM4a"\)/);
  assert.match(kotlin, /MediaExtractor\(\)/);
  assert.match(kotlin, /MediaCodec\.createDecoderByType/);
  const executable = kotlin.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(executable, /FFmpeg|AudioBuffer|ByteArray\(source\.length|readBytes\(\)/);
  const gradle = fs.readFileSync(base + '/android/build.gradle', 'utf8');
  assert.match(gradle, /expo-module-gradle-plugin/);
  assert.doesNotMatch(gradle, /dependencies\s*\{/);
});

test('Native decoder processes bounded PCM output to 16k mono WAV without changing source', () => {
  assert.match(kotlin, /require\(parsed\.scheme == "file"\)/);
  assert.match(kotlin, /source\.path\.startsWith\(root\.path \+ File\.separator\)/);
  assert.match(kotlin, /source\.isFile/);
  assert.match(kotlin, /MediaCodec\.BufferInfo/);
  assert.match(kotlin, /dequeueInputBuffer/);
  assert.match(kotlin, /dequeueOutputBuffer/);
  assert.match(kotlin, /StreamingMonoResampler/);
  assert.match(kotlin, /ByteArray\(8192\)/);
  assert.match(kotlin, /AudioFormat\.ENCODING_PCM_16BIT/);
  assert.match(kotlin, /pending\.renameTo\(output\)/);
  assert.match(kotlin, /writeWavHeader/);
  assert.match(kotlin, /"sampleRate" to 16000/);
  assert.match(kotlin, /"channels" to 1/);
  assert.doesNotMatch(kotlin, /source\.delete\(\)|source\.renameTo\(|setDataSource\(uri\)/);
});

test('Android adapter does not touch Data Core or silently fake the missing native module', () => {
  assert.match(adapter, /requireOptionalNativeModule/);
  assert.match(adapter, /createUnconfiguredMobileAudioPreprocessor/);
  assert.match(adapter, /createConfiguredMobileAudioPreprocessor/);
  assert.match(adapter, /module\.prepareM4a\(recording\.uri\)/);
  assert.match(adapter, /derived\.sampleRate !== 16000/);
  assert.match(compose, /prepareQuickVoiceWhisperProvider/);
  assert.match(compose, /ensureMeetingTranscript/);
  assert.match(stt, /transcribeMeetingRecording/);
  assert.match(stt, /loadMeetingTranscript/);
  assert.match(stt, /saveMeetingTranscript/);
  for (const code of [adapter, compose, stt]) {
    assert.doesNotMatch(code, /fetch\(|upload\(|supabase|service_role|createSchedule|saveWorklog/);
  }
});
