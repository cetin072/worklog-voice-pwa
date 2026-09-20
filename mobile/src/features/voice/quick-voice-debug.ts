export type QuickVoiceDebugStage =
  | 'provider_prepare'
  | 'model_resolve'
  | 'init_whisper'
  | 'capture'
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
