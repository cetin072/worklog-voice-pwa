export type MobileRecordingAudioInput = {
  sourceKind: 'mobile-recording';
  uri: string;
  fileName: string;
  mimeType: string;
  durationMs: number;
  createdAt: string;
};

export type QuickVoicePcmSignal = Readonly<{
  peak: number;
  rms: number;
  nonZeroRatio: number;
}>;

export type PreparedPcmFileAudioInput = {
  sourceKind: 'prepared-pcm-file';
  uri: string;
  fileName: string;
  mimeType: 'audio/wav';
  sampleRate: number;
  channels: number;
  encoding: 'pcm16-wav';
  durationMs: number;
  createdAt: string;
};

export type QuickVoicePcmAudioInput = {
  sourceKind: 'quick-voice-pcm';
  localRef: string;
  data: ArrayBuffer;
  sampleRate: number;
  channels: number;
  encoding: 'int16';
  durationMs: number;
  createdAt: string;
  signal: QuickVoicePcmSignal;
};

export type MobileSttAudioInput = MobileRecordingAudioInput | PreparedPcmFileAudioInput | QuickVoicePcmAudioInput;

function fileNameFromUri(uri: string) {
  const cleanUri = uri.split(/[?#]/, 1)[0];
  const lastSegment = cleanUri.split('/').filter(Boolean).at(-1) || 'recording.m4a';

  try {
    return decodeURIComponent(lastSegment);
  } catch {
    return lastSegment;
  }
}

function mimeTypeFromFileName(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.webm')) return 'audio/webm';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  return 'audio/mp4';
}

function normalizedCreatedAt(value?: string) {
  const date = value ? new Date(value) : new Date();
  if (!Number.isFinite(date.getTime())) throw new Error('오디오 생성 시각이 올바르지 않습니다.');
  return date.toISOString();
}

export function createMobileRecordingAudioInput(input: {
  uri: string;
  durationMs: number;
  createdAt?: string;
}): MobileRecordingAudioInput {
  const uri = input.uri.trim();
  if (!uri) {
    throw new Error('녹음 파일 경로가 없습니다.');
  }

  const durationMs = Math.max(0, Math.round(input.durationMs));
  const fileName = fileNameFromUri(uri);

  return {
    sourceKind: 'mobile-recording',
    uri,
    fileName,
    mimeType: mimeTypeFromFileName(fileName),
    durationMs,
    createdAt: normalizedCreatedAt(input.createdAt),
  };
}

export function createPreparedPcmFileAudioInput(input: {
  uri: string;
  sampleRate: number;
  channels: number;
  durationMs: number;
  createdAt?: string;
}): PreparedPcmFileAudioInput {
  const uri = input.uri.trim();
  if (!uri) throw new Error('전처리된 PCM/WAV 파일 경로가 없습니다.');
  if (!Number.isFinite(input.sampleRate) || input.sampleRate <= 0) {
    throw new Error('전처리된 PCM/WAV sampleRate가 올바르지 않습니다.');
  }
  if (!Number.isInteger(input.channels) || input.channels <= 0) {
    throw new Error('전처리된 PCM/WAV channels가 올바르지 않습니다.');
  }
  const fileName = fileNameFromUri(uri);
  if (!fileName.toLowerCase().endsWith('.wav')) {
    throw new Error('STT 전처리 결과는 WAV 파일이어야 합니다.');
  }

  return Object.freeze({
    sourceKind: 'prepared-pcm-file' as const,
    uri,
    fileName,
    mimeType: 'audio/wav' as const,
    sampleRate: Math.round(input.sampleRate),
    channels: input.channels,
    encoding: 'pcm16-wav' as const,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    createdAt: normalizedCreatedAt(input.createdAt),
  });
}

export function createQuickVoicePcmAudioInput(input: {
  localRef: string;
  data: ArrayBuffer;
  sampleRate: number;
  channels: number;
  durationMs: number;
  signal: QuickVoicePcmSignal;
  createdAt?: string;
}): QuickVoicePcmAudioInput {
  const localRef = input.localRef.trim();
  if (!localRef) throw new Error('Quick Voice PCM localRef가 필요합니다.');
  if (!(input.data instanceof ArrayBuffer) || input.data.byteLength === 0) {
    throw new Error('Quick Voice PCM 데이터가 없습니다.');
  }
  if (!Number.isFinite(input.sampleRate) || input.sampleRate <= 0) {
    throw new Error('Quick Voice PCM sampleRate가 올바르지 않습니다.');
  }
  if (!Number.isInteger(input.channels) || input.channels <= 0) {
    throw new Error('Quick Voice PCM channels가 올바르지 않습니다.');
  }

  return Object.freeze({
    sourceKind: 'quick-voice-pcm' as const,
    localRef,
    data: input.data,
    sampleRate: Math.round(input.sampleRate),
    channels: input.channels,
    encoding: 'int16' as const,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    createdAt: normalizedCreatedAt(input.createdAt),
    signal: Object.freeze({
      peak: Math.max(0, Math.min(1, Number(input.signal.peak) || 0)),
      rms: Math.max(0, Math.min(1, Number(input.signal.rms) || 0)),
      nonZeroRatio: Math.max(0, Math.min(1, Number(input.signal.nonZeroRatio) || 0)),
    }),
  });
}

export function trustedAudioLocalRef(audio: MobileSttAudioInput) {
  if (audio.sourceKind === 'mobile-recording' || audio.sourceKind === 'prepared-pcm-file') {
    const uri = audio.uri.trim();
    if (!uri) throw new Error('검증된 모바일 녹음 경로가 필요합니다.');
    return uri;
  }

  const localRef = audio.localRef.trim();
  if (!localRef) throw new Error('검증된 Quick Voice PCM 참조가 필요합니다.');
  return localRef;
}
