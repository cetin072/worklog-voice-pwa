import { initWhisper } from 'whisper.rn';

import type { MobileTranscriptionProvider } from '../transcription-provider';
import type { ResolvedSttModel } from '../stt-model';
import {
  createWhisperRnTranscriptionProvider,
  type WhisperRnContextLike,
} from './whisper-rn-provider';

export type WhisperRnRuntime = Readonly<{
  provider: MobileTranscriptionProvider;
  release(): Promise<void>;
}>;

/**
 * The only composition point that imports whisper.rn.
 *
 * Deleting/replacing this module must not require UI, Data Core, or transcript
 * contract changes.
 */
export async function initializeWhisperRnRuntime(input: {
  model: ResolvedSttModel;
  maxThreads?: number;
}): Promise<WhisperRnRuntime> {
  if (input.model.descriptor.provider !== 'whisper-rn') {
    throw new Error('whisper.rn runtime용 model이 필요합니다.');
  }

  const context = await initWhisper({
    filePath: input.model.localPath,
  });

  const provider = createWhisperRnTranscriptionProvider({
    context: context as WhisperRnContextLike,
    model: input.model,
    maxThreads: input.maxThreads,
  });

  return Object.freeze({
    provider,
    async release() {
      await context.release();
    },
  });
}
