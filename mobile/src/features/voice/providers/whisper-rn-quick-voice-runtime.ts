import { defineDownloadableSttModel, createExpoSttModelResolver, type SttModelDownloadProgress } from '../stt-model-download';
import { defineSttModel } from '../stt-model';
import type { ResolvedSttModel } from '../stt-model';
import { reportQuickVoiceDebug } from '../quick-voice-debug';
import type { MobileTranscriptionProvider } from '../transcription-provider';
import {
  initializeWhisperRnRuntime,
  type WhisperRnRuntime,
} from './whisper-rn-runtime';

// Human QA showed the multilingual tiny model returning unusable special-token
// output on the target Samsung device. Keep the same replaceable whisper.rn
// provider boundary but raise the default runtime model to multilingual base.
// The model is still fetched on first use and remains outside the APK.
export const QUICK_VOICE_WHISPER_MODEL = defineDownloadableSttModel({
  descriptor: defineSttModel({
    id: 'whisper.cpp-base-multilingual',
    provider: 'whisper-rn',
    version: 'ggml-base-60ed5bc3dd14',
    language: 'multilingual',
    format: 'ggml',
    sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
    downloadBytes: 147_951_465,
  }),
  downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
  fileName: 'ggml-base-multilingual-60ed5bc3dd14.bin',
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
      reportQuickVoiceDebug('model_resolve', 'started');
      let model: ResolvedSttModel;
      try {
        model = await modelResolver.ensureAvailable(QUICK_VOICE_WHISPER_MODEL.descriptor);
        reportQuickVoiceDebug('model_resolve', 'succeeded');
      } catch (error) {
        reportQuickVoiceDebug('model_resolve', 'failed', error);
        throw error;
      }
      reportQuickVoiceDebug('init_whisper', 'started');
      try {
        const runtime = await initializeWhisperRnRuntime({ model, maxThreads: 4 });
        activeRuntime = runtime;
        reportQuickVoiceDebug('init_whisper', 'succeeded');
        return runtime;
      } catch (error) {
        reportQuickVoiceDebug('init_whisper', 'failed', error);
        throw error;
      }
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
