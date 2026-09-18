import {
  createPreparedPcmFileAudioInput,
  type MobileRecordingAudioInput,
  type PreparedPcmFileAudioInput,
} from './audio-input';

const PREPROCESSOR_BRAND = Symbol('worklog.mobile.audio-preprocessor.v1');

export type AudioPreprocessorResult = Readonly<{
  uri: string;
  sampleRate: number;
  channels: number;
  durationMs: number;
}>;

export type MobileAudioPreprocessor = Readonly<{
  service: 'audio-preprocess';
  operation: 'prepare-stt';
  provider: string;
  configured: boolean;
  [PREPROCESSOR_BRAND]: true;
  prepare(input: MobileRecordingAudioInput): Promise<AudioPreprocessorResult>;
}>;

function providerName(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(normalized)) {
    throw new Error('Audio preprocessor 이름 형식이 올바르지 않습니다.');
  }
  return normalized;
}

export function createConfiguredMobileAudioPreprocessor(config: {
  provider: string;
  prepare(input: MobileRecordingAudioInput): Promise<AudioPreprocessorResult>;
}): MobileAudioPreprocessor {
  if (typeof config.prepare !== 'function') throw new Error('Audio preprocessor prepare 함수가 필요합니다.');
  return Object.freeze({
    [PREPROCESSOR_BRAND]: true as const,
    service: 'audio-preprocess' as const,
    operation: 'prepare-stt' as const,
    provider: providerName(config.provider),
    configured: true,
    prepare: config.prepare,
  });
}

export function createUnconfiguredMobileAudioPreprocessor(provider: string): MobileAudioPreprocessor {
  const normalized = providerName(provider);
  return Object.freeze({
    [PREPROCESSOR_BRAND]: true as const,
    service: 'audio-preprocess' as const,
    operation: 'prepare-stt' as const,
    provider: normalized,
    configured: false,
    async prepare() {
      throw new Error(`${normalized} Audio preprocessor가 아직 연결되지 않았습니다.`);
    },
  });
}

/**
 * Converts a durable meeting/call recording into a provider-neutral STT-ready
 * PCM/WAV file. The original recording is never replaced or deleted here.
 */
export async function prepareRecordingForStt(
  preprocessor: MobileAudioPreprocessor,
  recording: MobileRecordingAudioInput,
): Promise<PreparedPcmFileAudioInput> {
  if (
    !preprocessor
    || preprocessor[PREPROCESSOR_BRAND] !== true
    || preprocessor.service !== 'audio-preprocess'
    || preprocessor.operation !== 'prepare-stt'
  ) {
    throw new Error('업무수첩 Audio Preprocessor Adapter로 생성된 provider가 필요합니다.');
  }
  if (!preprocessor.configured) {
    throw new Error('연결된 Audio preprocessor가 필요합니다.');
  }
  if (!recording.uri.trim()) throw new Error('전처리할 모바일 녹음 파일이 없습니다.');

  const result = await preprocessor.prepare(Object.freeze({ ...recording }));
  return createPreparedPcmFileAudioInput({
    uri: result.uri,
    sampleRate: result.sampleRate,
    channels: result.channels,
    durationMs: result.durationMs || recording.durationMs,
    createdAt: recording.createdAt,
  });
}
