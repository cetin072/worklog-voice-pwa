import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import {
  createConfiguredMobileAudioPreprocessor,
  createUnconfiguredMobileAudioPreprocessor,
  type MobileAudioPreprocessor,
  type AudioPreprocessorResult,
} from '../audio-preprocessor';

type NativeMeetingAudio = Readonly<{
  prepareM4a(sourceUri: string): Promise<AudioPreprocessorResult>;
}>;

/**
 * Only this adapter knows about the Android MediaExtractor/MediaCodec module.
 * Transcript core, UI, and Data Core never import it.
 * An old QA APK must fail closed rather than claim it transcribed an M4A.
 */
export function createAndroidMeetingAudioPreprocessor(): MobileAudioPreprocessor {
  if (Platform.OS !== 'android') return createUnconfiguredMobileAudioPreprocessor('android-mediacodec');
  const module = requireOptionalNativeModule<NativeMeetingAudio>('WorklogMeetingAudio');
  if (!module) return createUnconfiguredMobileAudioPreprocessor('android-mediacodec');

  return createConfiguredMobileAudioPreprocessor({
    provider: 'android-mediacodec',
    async prepare(recording) {
      if (recording.sourceKind !== 'mobile-recording' ||
          !/^file:\/\//.test(recording.uri) ||
          !/^recording-[0-9a-f-]{36}\.m4a$/i.test(recording.fileName)) {
        throw new Error('기기에 저장된 회의 녹음 M4A만 전사 준비할 수 있습니다.');
      }
      const derived = await module.prepareM4a(recording.uri);
      if (!derived?.uri || derived.uri === recording.uri ||
          !/^file:\/\//.test(derived.uri) || !derived.uri.toLowerCase().endsWith('.wav') ||
          derived.sampleRate !== 16000 || derived.channels !== 1 ||
          !Number.isFinite(derived.durationMs) || derived.durationMs <= 0) {
        throw new Error('전사 준비 결과의 오디오 형식을 검증하지 못했습니다.');
      }
      return derived;
    },
  });
}
