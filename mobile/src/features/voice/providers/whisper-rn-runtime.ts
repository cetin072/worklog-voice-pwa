import type { MobileTranscriptionProvider } from '../transcription-provider';
import type { ResolvedSttModel } from '../stt-model';
import {
  createWhisperRnTranscriptionProvider,
  type WhisperRnContextLike,
} from './whisper-rn-provider';

type WhisperRnNativeContextLike = WhisperRnContextLike & Readonly<{
  release(): Promise<void>;
}>;

type WhisperRnModuleLike = Readonly<{
  initWhisper(input: {
    filePath: string;
  }): Promise<WhisperRnNativeContextLike>;
}>;

/**
 * Upstream whisper.rn 0.7.2 currently exposes only wildcard package exports,
 * and its React Native source references a global type that leaks into the
 * consumer TypeScript program. Keep that packaging defect inside this single
 * composition file instead of weakening app-wide type checking.
 *
 * Metro can statically resolve this literal require while TypeScript does not
 * need to compile whisper.rn's source module.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
declare const require: (moduleId: 'whisper.rn/index') => WhisperRnModuleLike;

const { initWhisper } = require('whisper.rn/index');

export type WhisperRnRuntime = Readonly<{
  provider: MobileTranscriptionProvider;
  release(): Promise<void>;
}>;

/**
 * The only composition point that loads whisper.rn.
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
    context,
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
