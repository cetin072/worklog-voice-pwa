import {
  createConfiguredMobileTranscriptionProvider,
  type MobileTranscriptionProvider,
} from '../transcription-provider';
import type { ResolvedSttModel } from '../stt-model';

export type SenseVoiceNativeResult = Readonly<{
  text?: string;
  language?: string;
  elapsedMs?: number;
}>;

/**
 * App-owned runtime boundary.
 *
 * A future Android/Kotlin sherpa-onnx bridge implements only this interface.
 * UI/Core/Data Core never import sherpa-onnx classes or React Native native
 * module types directly.
 */
export type SenseVoiceRuntimeLike = Readonly<{
  transcribePcm16(input: {
    data: ArrayBuffer;
    sampleRate: number;
    channels: number;
    language: string;
  }): Promise<SenseVoiceNativeResult>;
}>;

export function createSenseVoiceTranscriptionProvider(input: {
  runtime: SenseVoiceRuntimeLike;
  model: ResolvedSttModel;
}): MobileTranscriptionProvider {
  if (input.model.descriptor.provider !== 'sherpa-onnx') {
    throw new Error('SenseVoice provider용 sherpa-onnx model이 필요합니다.');
  }

  return createConfiguredMobileTranscriptionProvider({
    provider: 'sherpa-onnx',
    async transcribe({ audio, language }) {
      if (audio.sourceKind !== 'quick-voice-pcm') {
        throw new Error('SenseVoice Quick Voice PoC는 raw PCM 입력이 필요합니다.');
      }
      if (audio.sampleRate !== 16_000 || audio.channels !== 1 || audio.encoding !== 'int16') {
        throw new Error('SenseVoice Quick Voice PoC는 16kHz mono int16 PCM 입력만 허용합니다.');
      }

      const result = await input.runtime.transcribePcm16({
        data: audio.data,
        sampleRate: audio.sampleRate,
        channels: audio.channels,
        language,
      });

      return {
        text: result.text,
        language: result.language || language,
        model: input.model.descriptor.id,
      };
    },
  });
}
