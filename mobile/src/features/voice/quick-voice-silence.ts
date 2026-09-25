export const QUICK_VOICE_SILENCE_FRAME_MS = 20;
export const QUICK_VOICE_SPEECH_PADDING_MS = 180;
export const QUICK_VOICE_MAX_INTERNAL_SILENCE_MS = 320;
export const QUICK_VOICE_MIN_ACTIVE_SPEECH_MS = 240;

const MIN_RMS_THRESHOLD = 0.003;
// Quiet Korean speech in a recording that also contains a loud phrase must
// remain speech. Do not let a recording-wide loud peak raise this threshold.
const MAX_QUIET_SPEECH_RMS_THRESHOLD = 0.006;
const MIN_PEAK_THRESHOLD = 0.02;
const MAX_QUIET_SPEECH_PEAK_THRESHOLD = 0.024;

export type QuickVoiceSilenceCompaction = Readonly<{
  data: ArrayBuffer;
  originalDurationMs: number;
  processedDurationMs: number;
  activeSpeechMs: number;
  removedSilenceMs: number;
}>;

type FrameEnergy = Readonly<{ startSample: number; endSample: number; rms: number; peak: number }>;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function percentile(values: readonly number[], ratio: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio)))] || 0;
}

function measureFrame(view: DataView, startSample: number, endSample: number): FrameEnergy {
  let squareSum = 0;
  let peak = 0;
  for (let sampleIndex = startSample; sampleIndex < endSample; sampleIndex += 1) {
    const normalized = view.getInt16(sampleIndex * 2, true) / 32_768;
    const absolute = Math.abs(normalized);
    squareSum += normalized * normalized;
    peak = Math.max(peak, absolute);
  }
  return Object.freeze({
    startSample,
    endSample,
    rms: Math.sqrt(squareSum / Math.max(1, endSample - startSample)),
    peak,
  });
}

/**
 * Prepares capture-first fallback PCM for Whisper only. Short pauses and a
 * boundary cushion are retained; only excessive silence is removed.
 */
export function compactQuickVoicePcmSilence(data: ArrayBuffer, sampleRate: number): QuickVoiceSilenceCompaction {
  if (!(data instanceof ArrayBuffer) || !data.byteLength || data.byteLength % 2 !== 0) {
    throw new Error('Quick Voice 무음 정리용 PCM 데이터가 올바르지 않습니다.');
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error('Quick Voice 무음 정리용 sampleRate가 올바르지 않습니다.');
  }

  const sampleCount = data.byteLength / 2;
  const frameSamples = Math.max(1, Math.round(sampleRate * QUICK_VOICE_SILENCE_FRAME_MS / 1000));
  const view = new DataView(data);
  const frames: FrameEnergy[] = [];
  for (let startSample = 0; startSample < sampleCount; startSample += frameSamples) {
    frames.push(measureFrame(view, startSample, Math.min(sampleCount, startSample + frameSamples)));
  }

  const noiseFloor = percentile(frames.map((frame) => frame.rms), 0.2);
  const rmsThreshold = clamp(noiseFloor * 2.5 + 0.001, MIN_RMS_THRESHOLD, MAX_QUIET_SPEECH_RMS_THRESHOLD);
  const peakThreshold = clamp(rmsThreshold * 4, MIN_PEAK_THRESHOLD, MAX_QUIET_SPEECH_PEAK_THRESHOLD);
  const active = frames.map((frame) => frame.rms >= rmsThreshold || frame.peak >= peakThreshold);
  const activeSpeechMs = active.filter(Boolean).length * QUICK_VOICE_SILENCE_FRAME_MS;
  if (activeSpeechMs < QUICK_VOICE_MIN_ACTIVE_SPEECH_MS) {
    throw new Error('말소리가 충분히 감지되지 않았습니다. 짧게라도 문장을 말한 뒤 다시 저장해주세요.');
  }

  const keep = [...active];
  const paddingFrames = Math.ceil(QUICK_VOICE_SPEECH_PADDING_MS / QUICK_VOICE_SILENCE_FRAME_MS);
  active.forEach((isActive, index) => {
    if (!isActive) return;
    for (let padded = Math.max(0, index - paddingFrames); padded <= Math.min(keep.length - 1, index + paddingFrames); padded += 1) keep[padded] = true;
  });
  const firstKept = keep.indexOf(true);
  const lastKept = keep.lastIndexOf(true);
  const selected = new Array<boolean>(keep.length).fill(false);
  const maxInternalFrames = Math.max(1, Math.floor(QUICK_VOICE_MAX_INTERNAL_SILENCE_MS / QUICK_VOICE_SILENCE_FRAME_MS));
  for (let index = firstKept; index <= lastKept;) {
    if (keep[index]) { selected[index] = true; index += 1; continue; }
    const gapStart = index;
    while (index <= lastKept && !keep[index]) index += 1;
    const gapEnd = index;
    const keptGapFrames = Math.min(maxInternalFrames, gapEnd - gapStart);
    for (let kept = 0; kept < keptGapFrames; kept += 1) selected[gapStart + kept] = true;
  }

  const selectedSamples = frames.reduce((total, frame, index) => total + (selected[index] ? frame.endSample - frame.startSample : 0), 0);
  const compacted = new Uint8Array(selectedSamples * 2);
  const source = new Uint8Array(data);
  let byteOffset = 0;
  frames.forEach((frame, index) => {
    if (!selected[index]) return;
    const bytes = source.subarray(frame.startSample * 2, frame.endSample * 2);
    compacted.set(bytes, byteOffset);
    byteOffset += bytes.byteLength;
  });

  const originalDurationMs = Math.round(sampleCount / sampleRate * 1000);
  const processedDurationMs = Math.round(selectedSamples / sampleRate * 1000);
  return Object.freeze({
    data: compacted.buffer,
    originalDurationMs,
    processedDurationMs,
    activeSpeechMs,
    removedSilenceMs: Math.max(0, originalDurationMs - processedDurationMs),
  });
}
