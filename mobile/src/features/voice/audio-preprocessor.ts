import {
  createPreparedPcmFileAudioInput,
  type MobileRecordingAudioInput,
  type PreparedPcmFileAudioInput,
} from './audio-input';

const PREPROCESSOR_BRAND = Symbol('worklog.mobile.audio-preprocessor.v1');

export type PreparedAudioCheckpoint = Readonly<{
  sourceUri: string;
  preparedUri: string;
  sampleRate: number;
  channels: number;
  durationMs: number;
  createdAt: string;
}>;

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

export function assertStreamingSafePreprocessorResult(
  result: AudioPreprocessorResult,
  recording: MobileRecordingAudioInput,
) {
  if (!result.uri?.trim()) throw new Error('STT 전처리 결과 파일 경로가 없습니다.');
  if (result.uri === recording.uri) {
    throw new Error('STT 전처리 파일은 원본 회의 녹음과 다른 경로에 저장해야 합니다.');
  }
  if (!Number.isFinite(result.sampleRate) || result.sampleRate <= 0) {
    throw new Error('STT 전처리 sampleRate가 올바르지 않습니다.');
  }
  if (!Number.isInteger(result.channels) || result.channels <= 0) {
    throw new Error('STT 전처리 channels가 올바르지 않습니다.');
  }
  if (!Number.isFinite(result.durationMs) || result.durationMs < 0) {
    throw new Error('STT 전처리 durationMs가 올바르지 않습니다.');
  }
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
  assertStreamingSafePreprocessorResult(result, recording);
  return createPreparedPcmFileAudioInput({
    uri: result.uri,
    sampleRate: result.sampleRate,
    channels: result.channels,
    durationMs: result.durationMs || recording.durationMs,
    createdAt: recording.createdAt,
  });
}


export function createPreparedAudioCheckpoint(
  recording: MobileRecordingAudioInput,
  prepared: PreparedPcmFileAudioInput,
): PreparedAudioCheckpoint {
  if (prepared.uri === recording.uri) {
    throw new Error('전처리 checkpoint가 원본 회의 녹음을 덮어쓸 수 없습니다.');
  }
  return Object.freeze({
    sourceUri: recording.uri,
    preparedUri: prepared.uri,
    sampleRate: prepared.sampleRate,
    channels: prepared.channels,
    durationMs: prepared.durationMs,
    createdAt: new Date().toISOString(),
  });
}
