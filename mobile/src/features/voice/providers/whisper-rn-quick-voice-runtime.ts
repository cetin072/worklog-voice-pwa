import { defineDownloadableSttModel, createExpoSttModelResolver, type SttModelDownloadProgress } from '../stt-model-download';
import { defineSttModel } from '../stt-model';
import type { MobileTranscriptionProvider } from '../transcription-provider';
import {
  initializeWhisperRnRuntime,
  type WhisperRnRuntime,
} from './whisper-rn-runtime';

// This is the multilingual tiny Whisper model. It is intentionally fetched at
// first use rather than bundled into the APK. Its checksum is the SHA-256
// published with the model artifact.
export const QUICK_VOICE_WHISPER_MODEL = defineDownloadableSttModel({
  descriptor: defineSttModel({
    id: 'whisper.cpp-tiny-multilingual',
    provider: 'whisper-rn',
    version: 'ggml-tiny-be07e048e1e5',
    language: 'multilingual',
    format: 'ggml',
    sha256: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21',
    downloadBytes: 77_691_713,
  }),
  downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
  fileName: 'ggml-tiny-multilingual-be07e048e1e5.bin',
});

export type QuickVoiceModelDownloadProgress = Readonly<{
  bytesWritten: number;
  totalBytes: number | null;
}>;

const progressListeners = new Set<(progress: QuickVoiceModelDownloadProgress) => void>();
const modelResolver = createExpoSttModelResolver({
  models: [QUICK_VOICE_WHISPER_MODEL],
  onProgress(progress: SttModelDownloadProgress) {
    if (progress.modelId !== QUICK_VOICE_WHISPER_MODEL.descriptor.id) return;
    for (const listener of progressListeners) {
      listener({ bytesWritten: progress.bytesWritten, totalBytes: progress.totalBytes });
    }
  },
});
let runtimePromise: Promise<WhisperRnRuntime> | null = null;
let activeRuntime: WhisperRnRuntime | null = null;

/** The app composition root for the first replaceable Quick Voice provider. */
export async function prepareQuickVoiceWhisperProvider(
  onProgress?: (progress: QuickVoiceModelDownloadProgress) => void,
): Promise<MobileTranscriptionProvider> {
  if (onProgress) progressListeners.add(onProgress);
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const model = await modelResolver.ensureAvailable(QUICK_VOICE_WHISPER_MODEL.descriptor);
      const runtime = await initializeWhisperRnRuntime({ model, maxThreads: 4 });
      activeRuntime = runtime;
      return runtime;
    })().catch((error) => {
      runtimePromise = null;
      throw error;
    });
  }
  try {
    return (await runtimePromise).provider;
  } finally {
    if (onProgress) progressListeners.delete(onProgress);
  }
}

export async function releaseQuickVoiceWhisperProvider() {
  const runtime = activeRuntime;
  activeRuntime = null;
  runtimePromise = null;
  if (runtime) await runtime.release();
}
