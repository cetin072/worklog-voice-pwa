export type QuickVoiceDebugStage =
  | 'provider_prepare'
  | 'model_resolve'
  | 'init_whisper'
  | 'capture'
  | 'pcm_compaction'
  | 'transcribe_data'
  | 'result_normalization';

export function reportQuickVoiceDebug(stage: QuickVoiceDebugStage, outcome: 'started' | 'succeeded' | 'failed', error?: unknown) {
  const detail = error instanceof Error ? error.message : undefined;
  const payload = {
    feature: 'quick_voice',
    stage,
    outcome,
    ...(outcome === 'failed' ? { code: `quick_voice_${stage}_failed`, detail: detail || 'unknown_error' } : {}),
  };
  if (outcome === 'failed') console.warn('[quick-voice]', payload);
  else console.info('[quick-voice]', payload);
}

/** Human QA/logcat evidence for the exact PCM duration sent to Whisper. */
export function reportQuickVoicePcmCompaction(input: { originalDurationMs: number; processedDurationMs: number; removedSilenceMs: number }) {
  console.info('[quick-voice]', {
    feature: 'quick_voice',
    stage: 'pcm_compaction',
    outcome: 'succeeded',
    originalDurationMs: input.originalDurationMs,
    processedDurationMs: input.processedDurationMs,
    removedSilenceMs: input.removedSilenceMs,
  });
}
