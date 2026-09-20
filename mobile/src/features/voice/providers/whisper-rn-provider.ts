import {
  createConfiguredMobileTranscriptionProvider,
  normalizeTranscriptText,
  type MobileTranscriptionProvider,
} from '../transcription-provider';
import type { ResolvedSttModel } from '../stt-model';
import { reportQuickVoiceDebug } from '../quick-voice-debug';

export type WhisperRnTranscribeResult = Readonly<{
  result?: string;
  language?: string;
  isAborted?: boolean;
  segments?: readonly Readonly<{ text?: string; t0?: number; t1?: number }>[];
}>;

export type WhisperRnContextLike = Readonly<{
  transcribe(
    filePath: string,
    options: {
      language: string;
      maxThreads?: number;
    },
  ): {
    stop(): Promise<void>;
    promise: Promise<WhisperRnTranscribeResult>;
  };
  transcribeData(
    data: ArrayBuffer,
    options: {
      language: string;
      maxThreads?: number;
    },
  ): {
    stop(): Promise<void>;
    promise: Promise<WhisperRnTranscribeResult>;
  };
}>;



/** Normalizes the native provider result without exposing it outside this adapter. */
function normalizedWhisperResult(
  result: WhisperRnTranscribeResult,
  language: string,
  modelId: string,
) {
  if (result.isAborted) {
    throw new Error('whisper.rn 전사가 취소되었습니다.');
  }

  const normalizeWhisperText = (value: unknown) => {
    try { return normalizeTranscriptText(value); }
    catch { return ''; }
  };
  const segmentText = (result.segments || [])
    .map((segment) => normalizeWhisperText(segment.text))
    .filter(Boolean)
    .join(' ')
    .trim();
  const resultText = normalizeWhisperText(result.result);

  return {
    text: segmentText && segmentText.length >= resultText.length ? segmentText : resultText,
    segments: (result.segments || []).flatMap((segment) => {
      const text = normalizeWhisperText(segment.text);
      if (!text) return [];
      const start = Number(segment.t0);
      const end = Number(segment.t1);
      return [{
        text,
        startMs: Number.isFinite(start) ? Math.max(0, Math.round(start * 10)) : undefined,
        endMs: Number.isFinite(end) ? Math.max(0, Math.round(end * 10)) : undefined,
      }];
    }),
    language: result.language || language,
    model: modelId,
  };
}

/**
 * Adapter only. The concrete whisper.rn import/initWhisper call belongs in the
 * mobile composition root so replacing whisper.rn never changes Core/UI/Data Core.
 */
export function createWhisperRnTranscriptionProvider(input: {
  context: WhisperRnContextLike;
  model: ResolvedSttModel;
  maxThreads?: number;
}): MobileTranscriptionProvider {
  const maxThreads = input.maxThreads;
  if (maxThreads !== undefined && (!Number.isInteger(maxThreads) || maxThreads <= 0 || maxThreads > 16)) {
    throw new Error('whisper.rn maxThreads가 올바르지 않습니다.');
  }
  if (input.model.descriptor.provider !== 'whisper-rn') {
    throw new Error('whisper.rn provider용 model이 필요합니다.');
  }

  return createConfiguredMobileTranscriptionProvider({
    provider: 'whisper-rn',
    async transcribe({ audio, language }) {
      if (audio.sourceKind === 'mobile-recording') {
        throw new Error('whisper.rn Android 파일 전사는 PCM WAV가 필요합니다. 회의 녹음을 먼저 STT용 WAV로 전처리해주세요.');
      }

      if (audio.sourceKind === 'prepared-pcm-file') {
        if (audio.mimeType !== 'audio/wav' || audio.encoding !== 'pcm16-wav') {
          throw new Error('whisper.rn 파일 전사는 16-bit PCM WAV 입력이 필요합니다.');
        }
        const task = input.context.transcribe(audio.uri, {
          language,
          ...(maxThreads ? { maxThreads } : {}),
        });
        return normalizedWhisperResult(await task.promise, language, input.model.descriptor.id);
      }

      if (audio.sampleRate !== 16_000 || audio.channels !== 1 || audio.encoding !== 'int16') {
        throw new Error('whisper.rn Quick Voice PoC는 16kHz mono int16 PCM 입력만 허용합니다.');
      }

      // whisper.rn 0.7.2's Android JSI implementation decodes the ArrayBuffer
      // with decodePcm16() before calling whisper_full_parallel. Its public TS
      // comment says float32, but the installed native implementation is the
      // runtime contract for this Android path. Keep Expo AudioStream's exact
      // signed PCM16 bytes intact; converting here makes native decodePcm16()
      // reinterpret Float32 bytes as unrelated PCM samples.
      reportQuickVoiceDebug('transcribe_data', 'started');
      let normalizing = false;
      try {
        const task = input.context.transcribeData(audio.data, {
          language,
          ...(maxThreads ? { maxThreads } : {}),
        });
        const result = await task.promise;
        reportQuickVoiceDebug('transcribe_data', 'succeeded');
        reportQuickVoiceDebug('result_normalization', 'started');
        normalizing = true;
        try {
          const normalized = normalizedWhisperResult(result, language, input.model.descriptor.id);
          reportQuickVoiceDebug('result_normalization', 'succeeded');
          return normalized;
        } catch (error) {
          reportQuickVoiceDebug('result_normalization', 'failed', error);
          throw error;
        }
      } catch (error) {
        if (!normalizing) reportQuickVoiceDebug('transcribe_data', 'failed', error);
        throw error;
      }
    },
  });
}
