export const QUICK_VOICE_SILENCE_FRAME_MS = 20;
export const QUICK_VOICE_SPEECH_PADDING_MS = 180;
export const QUICK_VOICE_MAX_INTERNAL_SILENCE_MS = 320;
export const QUICK_VOICE_MIN_ACTIVE_SPEECH_MS = 240;

const MIN_RMS_THRESHOLD = 0.003;
const MAX_RMS_THRESHOLD = 0.018;
const MIN_PEAK_THRESHOLD = 0.02;
const MAX_PEAK_THRESHOLD = 0.08;

export type QuickVoiceSilenceCompaction = Readonly<{
  data: ArrayBuffer;
  originalDurationMs: number;
  processedDurationMs: number;
  activeSpeechMs: number;
  speechRatio: number;
  removedSilenceMs: number;
  rmsThreshold: number;
  peakThreshold: number;
}>;

type FrameEnergy = Readonly<{
  startSample: number;
  endSample: number;
  rms: number;
  peak: number;
}>;

function frameEnergy(view: DataView, startSample: number, endSample: number): FrameEnergy {
  let squareSum = 0;
  let peak = 0;
  const count = Math.max(1, endSample - startSample);

  for (let sampleIndex = startSample; sampleIndex < endSample; sampleIndex += 1) {
    const normalized = view.getInt16(sampleIndex * 2, true) / 32_768;
    const absolute = Math.abs(normalized);
    if (absolute > peak) peak = absolute;
    squareSum += normalized * normalized;
  }

  return Object.freeze({
    startSample,
    endSample,
    rms: Math.sqrt(squareSum / count),
    peak,
  });
}

function percentile(values: readonly number[], ratio: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio)));
  return sorted[index];
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Conservatively removes only silence-heavy PCM regions before Whisper.
 *
 * - 20ms frame analysis keeps the detector responsive to short Korean words.
 * - thresholds adapt to the lower-energy portion of the recording while being
 *   bounded so quiet speech is not aggressively discarded.
 * - 180ms speech padding protects word boundaries.
 * - long internal pauses are shortened to <=320ms instead of being removed,
 *   preserving a natural separation between phrases.
 */
export function compactQuickVoicePcmSilence(
  data: ArrayBuffer,
  sampleRate: number,
): QuickVoiceSilenceCompaction {
  if (!(data instanceof ArrayBuffer) || !data.byteLength || data.byteLength % 2 !== 0) {
    throw new Error('Quick Voice 무음 정리용 PCM 데이터가 올바르지 않습니다.');
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error('Quick Voice 무음 정리용 sampleRate가 올바르지 않습니다.');
  }

  const sampleCount = data.byteLength / 2;
  const frameSamples = Math.max(1, Math.round(sampleRate * QUICK_VOICE_SILENCE_FRAME_MS / 1000));
  const frameCount = Math.ceil(sampleCount / frameSamples);
  const view = new DataView(data);
  const frames: FrameEnergy[] = [];

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const startSample = frameIndex * frameSamples;
    const endSample = Math.min(sampleCount, startSample + frameSamples);
    frames.push(frameEnergy(view, startSample, endSample));
  }

  const noiseFloor = percentile(frames.map((frame) => frame.rms), 0.2);
  const maxRms = Math.max(...frames.map((frame) => frame.rms));
  const maxPeak = Math.max(...frames.map((frame) => frame.peak));
  const adaptiveRms = noiseFloor * 2.5 + 0.001;
  const rmsThreshold = clamp(
    Math.min(adaptiveRms, Math.max(MIN_RMS_THRESHOLD, maxRms * 0.65)),
    MIN_RMS_THRESHOLD,
    MAX_RMS_THRESHOLD,
  );
  const peakThreshold = clamp(
    Math.min(rmsThreshold * 4, Math.max(MIN_PEAK_THRESHOLD, maxPeak * 0.65)),
    MIN_PEAK_THRESHOLD,
    MAX_PEAK_THRESHOLD,
  );
  const active = frames.map((frame) => frame.rms >= rmsThreshold || frame.peak >= peakThreshold);
  const activeFrameCount = active.reduce((count, value) => count + (value ? 1 : 0), 0);
  const activeSpeechMs = Math.round(activeFrameCount * QUICK_VOICE_SILENCE_FRAME_MS);

  if (activeSpeechMs < QUICK_VOICE_MIN_ACTIVE_SPEECH_MS) {
    throw new Error('말소리가 충분히 감지되지 않았습니다. 짧게라도 문장을 말한 뒤 다시 저장해주세요.');
  }

  const keep = [...active];
  const paddingFrames = Math.ceil(QUICK_VOICE_SPEECH_PADDING_MS / QUICK_VOICE_SILENCE_FRAME_MS);
  for (let frameIndex = 0; frameIndex < active.length; frameIndex += 1) {
    if (!active[frameIndex]) continue;
    const start = Math.max(0, frameIndex - paddingFrames);
    const end = Math.min(keep.length - 1, frameIndex + paddingFrames);
    for (let padIndex = start; padIndex <= end; padIndex += 1) keep[padIndex] = true;
  }

  const firstKept = keep.indexOf(true);
  const lastKept = keep.lastIndexOf(true);
  const selected = new Array<boolean>(keep.length).fill(false);
  for (let frameIndex = firstKept; frameIndex <= lastKept; frameIndex += 1) {
    if (keep[frameIndex]) selected[frameIndex] = true;
  }

  const maxInternalFrames = Math.max(1, Math.floor(QUICK_VOICE_MAX_INTERNAL_SILENCE_MS / QUICK_VOICE_SILENCE_FRAME_MS));
  let cursor = firstKept;
  while (cursor <= lastKept) {
    if (keep[cursor]) {
      cursor += 1;
      continue;
    }

    const gapStart = cursor;
    while (cursor <= lastKept && !keep[cursor]) cursor += 1;
    const gapEnd = cursor - 1;
    const gapLength = gapEnd - gapStart + 1;

    if (gapLength <= maxInternalFrames) {
      for (let frameIndex = gapStart; frameIndex <= gapEnd; frameIndex += 1) selected[frameIndex] = true;
      continue;
    }

    const leftFrames = Math.floor(maxInternalFrames / 2);
    const rightFrames = maxInternalFrames - leftFrames;
    for (let frameIndex = gapStart; frameIndex < gapStart + leftFrames; frameIndex += 1) selected[frameIndex] = true;
    for (let frameIndex = gapEnd - rightFrames + 1; frameIndex <= gapEnd; frameIndex += 1) selected[frameIndex] = true;
  }

  let selectedSamples = 0;
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    if (!selected[frameIndex]) continue;
    selectedSamples += frames[frameIndex].endSample - frames[frameIndex].startSample;
  }

  const compacted = new Uint8Array(selectedSamples * 2);
  const source = new Uint8Array(data);
  let byteOffset = 0;
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    if (!selected[frameIndex]) continue;
    const frame = frames[frameIndex];
    const bytes = source.subarray(frame.startSample * 2, frame.endSample * 2);
    compacted.set(bytes, byteOffset);
    byteOffset += bytes.byteLength;
  }

  const originalDurationMs = Math.round(sampleCount / sampleRate * 1000);
  const processedDurationMs = Math.round(selectedSamples / sampleRate * 1000);
  const speechRatio = sampleCount > 0 ? Math.min(1, (activeFrameCount * frameSamples) / sampleCount) : 0;

  return Object.freeze({
    data: compacted.buffer,
    originalDurationMs,
    processedDurationMs,
    activeSpeechMs,
    speechRatio,
    removedSilenceMs: Math.max(0, originalDurationMs - processedDurationMs),
    rmsThreshold,
    peakThreshold,
  });
}
