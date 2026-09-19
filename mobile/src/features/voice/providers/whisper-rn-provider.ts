import {
  createConfiguredMobileTranscriptionProvider,
  normalizeTranscriptText,
  type MobileTranscriptionProvider,
} from '../transcription-provider';
import type { ResolvedSttModel } from '../stt-model';

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



/**
 * Expo AudioStream int16 is little-endian signed PCM. whisper.rn Whisper
 * transcribeData consumes float32 PCM samples, so normalize at the provider
 * boundary instead of leaking a provider-specific audio format into Core.
 */
export function pcm16LittleEndianToFloat32Buffer(data: ArrayBuffer) {
  if (data.byteLength === 0 || data.byteLength % 2 !== 0) {
    throw new Error('whisper.rn 변환용 PCM16 데이터 길이가 올바르지 않습니다.');
  }

  const input = new DataView(data);
  const output = new Float32Array(data.byteLength / 2);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = input.getInt16(index * 2, true) / 32_768;
  }
  return output.buffer;
}

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

      const whisperPcm = pcm16LittleEndianToFloat32Buffer(audio.data);
      const task = input.context.transcribeData(whisperPcm, {
        language,
        ...(maxThreads ? { maxThreads } : {}),
      });
      return normalizedWhisperResult(await task.promise, language, input.model.descriptor.id);
    },
  });
}
