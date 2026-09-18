import type { MobileSttAudioInput } from './audio-input';
import {
  transcribeQuickVoice,
  type MobileTranscriptV1,
  type MobileTranscriptionProvider,
} from './transcription-provider';

export type QuickVoiceFlowStage = 'transcribe' | 'save';

export class QuickVoiceFlowError extends Error {
  readonly stage: QuickVoiceFlowStage;
  readonly causeValue: unknown;

  constructor(stage: QuickVoiceFlowStage, message: string, causeValue: unknown) {
    super(message);
    this.name = 'QuickVoiceFlowError';
    this.stage = stage;
    this.causeValue = causeValue;
  }
}

export type QuickVoiceFastPathResult<TSave = unknown> = Readonly<{
  transcript: MobileTranscriptV1;
  saveResult: TSave;
  clientRequestId: string;
  briefingRefreshError: Error | null;
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
  language?: string;
}): Promise<QuickVoiceFastPathResult<TSave>> {
  const clientRequestId = input.clientRequestId.trim();
  if (!clientRequestId) {
    throw new Error('Quick Voice clientRequestId가 필요합니다.');
  }

  let transcript: MobileTranscriptV1;
  try {
    transcript = await transcribeQuickVoice(
      input.provider,
      input.audio,
      input.language || 'ko',
    );
  } catch (causeValue) {
    const cause = errorOf(causeValue, '음성을 전사하지 못했습니다.');
    throw new QuickVoiceFlowError('transcribe', cause.message, causeValue);
  }

  let saveResult: TSave;
  try {
    saveResult = await input.saveWorklog(transcript.text, {
      clientRequestId,
      recordedAt: input.audio.createdAt,
    });
  } catch (causeValue) {
    const cause = errorOf(causeValue, '업무를 저장하지 못했습니다.');
    throw new QuickVoiceFlowError('save', cause.message, causeValue);
  }

  let briefingRefreshError: Error | null = null;
  try {
    await input.refreshBriefing();
  } catch (causeValue) {
    briefingRefreshError = errorOf(causeValue, '브리핑을 새로고침하지 못했습니다.');
  }

  return Object.freeze({
    transcript,
    saveResult,
    clientRequestId,
    briefingRefreshError,
  });
}
