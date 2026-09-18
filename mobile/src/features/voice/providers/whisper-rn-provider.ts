import {
  createConfiguredMobileTranscriptionProvider,
  type MobileTranscriptionProvider,
} from '../transcription-provider';
import type { ResolvedSttModel } from '../stt-model';

export type WhisperRnTranscribeResult = Readonly<{
  result?: string;
  language?: string;
  isAborted?: boolean;
}>;

export type WhisperRnContextLike = Readonly<{
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
      if (audio.sourceKind !== 'quick-voice-pcm') {
        throw new Error('whisper.rn Quick Voice PoC는 raw PCM 입력이 필요합니다.');
      }
      if (audio.sampleRate !== 16_000 || audio.channels !== 1 || audio.encoding !== 'int16') {
        throw new Error('whisper.rn Quick Voice PoC는 16kHz mono int16 PCM 입력만 허용합니다.');
      }

      const whisperPcm = pcm16LittleEndianToFloat32Buffer(audio.data);
      const task = input.context.transcribeData(whisperPcm, {
        language,
        ...(maxThreads ? { maxThreads } : {}),
      });
      const result = await task.promise;

      if (result.isAborted) {
        throw new Error('whisper.rn 전사가 취소되었습니다.');
      }

      return {
        text: result.result,
        language: result.language || language,
        model: input.model.descriptor.id,
      };
    },
  });
}
