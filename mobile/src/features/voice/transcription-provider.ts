import {
  trustedAudioLocalRef,
  type MobileSttAudioInput,
} from './audio-input';

const PROVIDER_BRAND = Symbol('worklog.mobile.transcription-provider.v1');
const MAX_TRANSCRIPT_TEXT = 500_000;
const MAX_SEGMENT_TEXT = 8_000;

type ProviderSegment = {
  text?: string;
  transcript?: string;
  startMs?: number;
  endMs?: number;
  startSeconds?: number;
  endSeconds?: number;
  speakerId?: string;
  speaker?: string;
  confidence?: number;
};

export type ProviderTranscriptResult = {
  text?: string;
  transcript?: string;
  segments?: ProviderSegment[];
  language?: string;
  model?: string;
  providerRequestId?: string;
};

export type MobileTranscriptSegment = {
  index: number;
  text: string;
  startMs: number | null;
  endMs: number | null;
  speakerId: string | null;
  confidence: number | null;
  sourceAudioRef: { localRef: string };
};

export type MobileTranscriptV1 = {
  schemaVersion: 'v1';
  text: string;
  segments: readonly MobileTranscriptSegment[];
  language: string;
  provider: string;
  model: string;
  providerRequestId: string;
  durationMs: number;
  sourceAudioRef: { localRef: string };
  createdAt: string;
};

export type MobileTranscriptionProviderInput = {
  audio: MobileSttAudioInput;
  language: string;
};

export type MobileTranscriptionProvider = Readonly<{
  service: 'stt';
  operation: 'transcribe';
  provider: string;
  configured: boolean;
  [PROVIDER_BRAND]: true;
  transcribe(input: MobileTranscriptionProviderInput): Promise<ProviderTranscriptResult>;
}>;

function cleanText(value: unknown, max: number, label: string) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length > max) throw new Error(`${label}가 허용 길이를 초과했습니다.`);
  return text;
}

export function normalizeTranscriptText(value: unknown) {
  const raw = cleanText(value, MAX_TRANSCRIPT_TEXT, 'transcript.text');
  const withoutWhisperControlTokens = raw
    .replace(/<\|[^|>]+\|>/g, ' ')
    .replace(/\[(?:S|BLANK_AUDIO|SILENCE|MUSIC|APPLAUSE|LAUGHTER)\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!withoutWhisperControlTokens) {
    throw new Error('음성에서 사용할 수 있는 전사 문장을 찾지 못했습니다. 다시 말씀해주세요.');
  }

  return withoutWhisperControlTokens;
}

function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function milliseconds(milliseconds: unknown, seconds: unknown) {
  const direct = finiteNumber(milliseconds);
  if (direct !== null) return direct;
  const value = finiteNumber(seconds);
  return value === null ? null : value * 1000;
}

function normalizeSegment(segment: ProviderSegment, index: number, localRef: string): MobileTranscriptSegment {
  const text = cleanText(segment.text ?? segment.transcript, MAX_SEGMENT_TEXT, `segments[${index}].text`);
  if (!text) throw new Error(`segments[${index}].text가 필요합니다.`);

  const startMs = milliseconds(segment.startMs, segment.startSeconds);
  const endMs = milliseconds(segment.endMs, segment.endSeconds);
  if (startMs !== null && startMs < 0) throw new Error(`segments[${index}].startMs가 올바르지 않습니다.`);
  if (endMs !== null && endMs < 0) throw new Error(`segments[${index}].endMs가 올바르지 않습니다.`);
  if (startMs !== null && endMs !== null && endMs < startMs) {
    throw new Error(`segments[${index}]의 종료시각이 시작시각보다 빠릅니다.`);
  }

  const confidence = finiteNumber(segment.confidence);
  if (confidence !== null && (confidence < 0 || confidence > 1)) {
    throw new Error(`segments[${index}].confidence가 올바르지 않습니다.`);
  }

  return Object.freeze({
    index,
    text,
    startMs,
    endMs,
    speakerId: cleanText(segment.speakerId ?? segment.speaker, 120, `segments[${index}].speakerId`) || null,
    confidence,
    sourceAudioRef: Object.freeze({ localRef }),
  });
}

function providerName(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(normalized)) {
    throw new Error('STT provider 이름 형식이 올바르지 않습니다.');
  }
  return normalized;
}

export function createConfiguredMobileTranscriptionProvider(config: {
  provider: string;
  transcribe(input: MobileTranscriptionProviderInput): Promise<ProviderTranscriptResult>;
}): MobileTranscriptionProvider {
  if (typeof config.transcribe !== 'function') throw new Error('STT transcribe 함수가 필요합니다.');
  return Object.freeze({
    [PROVIDER_BRAND]: true as const,
    service: 'stt' as const,
    operation: 'transcribe' as const,
    provider: providerName(config.provider),
    configured: true,
    transcribe: config.transcribe,
  });
}

export function createUnconfiguredMobileTranscriptionProvider(provider: string): MobileTranscriptionProvider {
  const normalizedProvider = providerName(provider);
  return Object.freeze({
    [PROVIDER_BRAND]: true as const,
    service: 'stt' as const,
    operation: 'transcribe' as const,
    provider: normalizedProvider,
    configured: false,
    async transcribe() {
      throw new Error(`${normalizedProvider} STT provider가 아직 연결되지 않았습니다.`);
    },
  });
}

export async function transcribeMobileAudio(
  provider: MobileTranscriptionProvider,
  audio: MobileSttAudioInput,
  language = 'ko',
): Promise<MobileTranscriptV1> {
  if (!provider || provider[PROVIDER_BRAND] !== true || provider.service !== 'stt' || provider.operation !== 'transcribe') {
    throw new Error('업무수첩 Mobile STT Adapter로 생성된 provider가 필요합니다.');
  }
  if (!provider.configured) throw new Error('연결된 STT provider가 필요합니다.');

  if (audio.sourceKind === 'mobile-recording' || audio.sourceKind === 'prepared-pcm-file') {
    if (!audio.uri.trim()) throw new Error('검증된 모바일 녹음 AudioInput이 필요합니다.');
  } else {
    if (!(audio.data instanceof ArrayBuffer) || !audio.data.byteLength) {
      throw new Error('검증된 Quick Voice PCM AudioInput이 필요합니다.');
    }
    if (!audio.localRef.trim() || audio.encoding !== 'int16') {
      throw new Error('검증된 Quick Voice PCM 메타데이터가 필요합니다.');
    }
  }

  const result = await provider.transcribe(Object.freeze({
    audio: Object.freeze({ ...audio }),
    language: cleanText(language, 24, 'language') || 'ko',
  }));

  const text = normalizeTranscriptText(result.text ?? result.transcript);

  const localRef = trustedAudioLocalRef(audio);
  const sourceAudioRef = Object.freeze({ localRef });
  const segments = Object.freeze((result.segments || []).map((segment, index) => normalizeSegment(segment, index, localRef)));

  return Object.freeze({
    schemaVersion: 'v1' as const,
    text,
    segments,
    language: cleanText(result.language, 24, 'transcript.language') || cleanText(language, 24, 'language') || 'ko',
    provider: provider.provider,
    model: cleanText(result.model, 120, 'transcript.model'),
    providerRequestId: cleanText(result.providerRequestId, 200, 'transcript.providerRequestId'),
    durationMs: Math.max(0, Math.round(audio.durationMs)),
    sourceAudioRef,
    createdAt: new Date(audio.createdAt).toISOString(),
  });
}


export async function transcribeQuickVoice(
  provider: MobileTranscriptionProvider,
  audio: MobileSttAudioInput,
  language = 'ko',
): Promise<MobileTranscriptV1> {
  return transcribeMobileAudio(provider, audio, language);
}
