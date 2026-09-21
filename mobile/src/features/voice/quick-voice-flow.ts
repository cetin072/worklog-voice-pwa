import type { MobileSttAudioInput } from './audio-input';
import {
  transcribeQuickVoice,
  type MobileTranscriptV1,
  type MobileTranscriptionProvider,
} from './transcription-provider';

export type QuickVoiceFlowStage = 'transcribe' | 'save';
export type QuickVoiceFlowProgress = 'transcribing' | 'saving' | 'refreshing';

export class QuickVoiceFlowError extends Error {
  readonly stage: QuickVoiceFlowStage;
  readonly causeValue: unknown;
  readonly transcript: MobileTranscriptV1 | null;

  constructor(stage: QuickVoiceFlowStage, message: string, causeValue: unknown, transcript: MobileTranscriptV1 | null = null) {
    super(message);
    this.name = 'QuickVoiceFlowError';
    this.stage = stage;
    this.causeValue = causeValue;
    this.transcript = transcript;
  }
}

export type QuickVoiceFlowTimings = Readonly<{
  transcribeMs: number | null;
  saveMs: number;
  briefingRefreshMs: number;
}>;

export type QuickVoiceFastPathResult<TSave = unknown> = Readonly<{
  transcript: MobileTranscriptV1;
  saveResult: TSave;
  clientRequestId: string;
  briefingRefreshError: Error | null;
  timings: QuickVoiceFlowTimings;
}>;

export type QuickVoiceTranscriptionResult = Readonly<{
  transcript: MobileTranscriptV1;
  transcribeMs: number;
}>;

function errorOf(value: unknown, fallback: string) {
  return value instanceof Error ? value : new Error(fallback);
}

export function createQuickVoiceClientRequestId(now = Date.now(), random = Math.random()) {
  const randomPart = Math.floor(Math.max(0, Math.min(0.999999999999, random)) * 1e12)
    .toString(36)
    .padStart(8, '0');
  return `mobile-quick-voice-${now}-${randomPart}`;
}

/**
 * Transcribes a captured Quick Voice input without crossing the persistence
 * boundary. The Voice fast path may persist a valid transcript immediately;
 * post-save correction belongs to the briefing edit flow.
 */
export async function transcribeQuickVoiceCapture(input: {
  provider: MobileTranscriptionProvider;
  audio: MobileSttAudioInput;
  language?: string;
}): Promise<QuickVoiceTranscriptionResult> {
  try {
    const transcribeStartedAt = Date.now();
    const transcript = await transcribeQuickVoice(
      input.provider,
      input.audio,
      input.language || 'ko',
    );
    return Object.freeze({
      transcript,
      transcribeMs: Math.max(0, Date.now() - transcribeStartedAt),
    });
  } catch (causeValue) {
    const cause = errorOf(causeValue, '음성을 전사하지 못했습니다.');
    throw new QuickVoiceFlowError('transcribe', cause.message, causeValue);
  }
}

/**
 * Provider-neutral Quick Voice fast path.
 *
 * A caller creates clientRequestId once per capture and retains it across
 * retries. This prevents an uncertain save response from creating duplicates.
 *
 * saveWorklog and refreshBriefing stay injected so this module does not know
 * HTTP endpoints, Supabase, Notion, or any STT-native implementation.
 */
export async function runQuickVoiceFastPath<TSave>(input: {
  provider: MobileTranscriptionProvider;
  audio: MobileSttAudioInput;
  clientRequestId: string;
  saveWorklog(transcript: string, options: {
    clientRequestId: string;
    recordedAt: string;
  }): Promise<TSave>;
  refreshBriefing(): Promise<unknown>;
  onProgress?: (stage: QuickVoiceFlowProgress) => void;
  language?: string;
}): Promise<QuickVoiceFastPathResult<TSave>> {
  const clientRequestId = input.clientRequestId.trim();
  if (!clientRequestId) {
    throw new Error('Quick Voice clientRequestId가 필요합니다.');
  }

  input.onProgress?.('transcribing');
  const { transcript, transcribeMs } = await transcribeQuickVoiceCapture(input);

  return saveQuickVoiceTranscript({
    transcript,
    clientRequestId,
    recordedAt: input.audio.createdAt,
    saveWorklog: input.saveWorklog,
    refreshBriefing: input.refreshBriefing,
    onProgress: input.onProgress,
    transcribeMs,
  });
}

/** Reuses the accepted STT transcript for a retry without invoking STT or changing its idempotency key. */
export async function saveQuickVoiceTranscript<TSave>(input: {
  transcript: MobileTranscriptV1;
  clientRequestId: string;
  recordedAt: string;
  saveWorklog(transcript: string, options: { clientRequestId: string; recordedAt: string }): Promise<TSave>;
  refreshBriefing(): Promise<unknown>;
  onProgress?: (stage: QuickVoiceFlowProgress) => void;
  transcribeMs?: number | null;
}): Promise<QuickVoiceFastPathResult<TSave>> {
  const clientRequestId = input.clientRequestId.trim();
  if (!clientRequestId) throw new Error('Quick Voice clientRequestId가 필요합니다.');
  if (!input.transcript.text.trim()) throw new Error('저장할 전사문이 없습니다.');

  let saveResult: TSave;
  let saveMs = 0;
  try {
    input.onProgress?.('saving');
    const saveStartedAt = Date.now();
    saveResult = await input.saveWorklog(input.transcript.text, { clientRequestId, recordedAt: input.recordedAt });
    saveMs = Math.max(0, Date.now() - saveStartedAt);
  } catch (causeValue) {
    const cause = errorOf(causeValue, '업무를 저장하지 못했습니다.');
    throw new QuickVoiceFlowError('save', cause.message, causeValue, input.transcript);
  }

  let briefingRefreshError: Error | null = null;
  let briefingRefreshMs = 0;
  try {
    input.onProgress?.('refreshing');
    const refreshStartedAt = Date.now();
    await input.refreshBriefing();
    briefingRefreshMs = Math.max(0, Date.now() - refreshStartedAt);
  } catch (causeValue) {
    briefingRefreshError = errorOf(causeValue, '브리핑을 새로고침하지 못했습니다.');
  }

  return Object.freeze({
    transcript: input.transcript,
    saveResult,
    clientRequestId,
    briefingRefreshError,
    timings: Object.freeze({
      transcribeMs: input.transcribeMs ?? null,
      saveMs,
      briefingRefreshMs,
    }),
  });
}

/** One immutable payload/key per automatic save attempt, including uncertain responses and concurrent retries. */
export function createQuickVoiceSaveAttempt<TSave>(input: Parameters<typeof saveQuickVoiceTranscript<TSave>>[0]) {
  const snapshot = { ...input, transcript: { ...input.transcript, text: input.transcript.text.trim() } };
  let pending: Promise<QuickVoiceFastPathResult<TSave>> | null = null;
  let completed: QuickVoiceFastPathResult<TSave> | null = null;
  return Object.freeze({
    text: snapshot.transcript.text,
    save(): Promise<QuickVoiceFastPathResult<TSave>> {
      if (completed) return Promise.resolve(completed);
      if (pending) return pending;
      pending = saveQuickVoiceTranscript(snapshot).then((result) => { completed = result; return result; })
        .finally(() => { pending = null; });
      return pending;
    },
  });
}

/**
 * Screen changes must not discard an active capture or captured/transcribed work.
 * The pre-capture permission/setup phase has no audio to preserve, so it must
 * never lock the rest of Home if native microphone startup is slow.
 */
export function quickVoiceNeedsAttention(phase: string) {
  return !['idle', 'preparing', 'saved', 'refresh_error'].includes(phase);
}
