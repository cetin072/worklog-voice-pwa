import {
  AudioModule,
  setAudioModeAsync,
  useAudioStream,
  type AudioStreamBuffer,
} from 'expo-audio';
import { useRef } from 'react';

import {
  createQuickVoicePcmAudioInput,
  type QuickVoicePcmAudioInput,
} from './audio-input';
import { cancelQuickVoiceCapture } from './quick-voice-capture-lifecycle';
import { reportQuickVoiceDebug } from './quick-voice-debug';
import { compactQuickVoicePcmSilence } from './quick-voice-silence';

export const QUICK_VOICE_PCM_SAMPLE_RATE = 16_000;
export const QUICK_VOICE_PCM_CHANNELS = 1;
export const QUICK_VOICE_PCM_ENCODING = 'int16' as const;
const MAX_CAPTURE_BYTES = 12 * 1024 * 1024;

export type QuickVoicePcmCapture = QuickVoicePcmAudioInput;

function copyBuffer(buffer: ArrayBuffer) {
  return new Uint8Array(buffer.slice(0));
}

export function concatenatePcmBuffers(chunks: readonly Uint8Array[]) {
  const totalBytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}

export function analyzePcm16Signal(data: ArrayBuffer) {
  if (!data.byteLength || data.byteLength % 2 !== 0) {
    throw new Error('Quick Voice PCM 신호 길이가 올바르지 않습니다.');
  }

  const view = new DataView(data);
  const sampleCount = data.byteLength / 2;
  let peak = 0;
  let squareSum = 0;
  let nonZeroSamples = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = view.getInt16(index * 2, true);
    const normalized = sample / 32_768;
    const absolute = Math.abs(normalized);
    if (absolute > peak) peak = absolute;
    squareSum += normalized * normalized;
    if (Math.abs(sample) >= 32) nonZeroSamples += 1;
  }

  return Object.freeze({
    peak,
    rms: Math.sqrt(squareSum / sampleCount),
    nonZeroRatio: nonZeroSamples / sampleCount,
  });
}

export function assertQuickVoiceSignal(signal: { peak: number; rms: number; nonZeroRatio: number }) {
  if (signal.peak < 0.002 && signal.rms < 0.0005) {
    throw new Error('마이크 입력이 거의 감지되지 않았습니다. 마이크 가까이에서 다시 말씀해주세요.');
  }
  if (signal.nonZeroRatio < 0.01) {
    throw new Error('녹음된 음성 신호가 너무 적습니다. 다시 말씀해주세요.');
  }
}

export function assertQuickVoicePcmFormat(input: { sampleRate: number; channels: number }) {
  if (input.sampleRate !== QUICK_VOICE_PCM_SAMPLE_RATE) {
    throw new Error(`Quick Voice STT는 현재 16kHz PCM이 필요합니다. 이 기기의 실제 입력은 ${input.sampleRate}Hz입니다.`);
  }
  if (input.channels !== QUICK_VOICE_PCM_CHANNELS) {
    throw new Error(`Quick Voice STT는 현재 mono PCM이 필요합니다. 이 기기의 실제 입력은 ${input.channels}채널입니다.`);
  }
}

export function useQuickVoicePcmCapture() {
  const chunks = useRef<Uint8Array[]>([]);
  const capturedBytes = useRef(0);
  const overflowed = useRef(false);
  const latestFormat = useRef({ sampleRate: 0, channels: 0 });
  const captureIdentity = useRef<{ localRef: string; createdAt: string } | null>(null);

  const stream = useAudioStream({
    sampleRate: QUICK_VOICE_PCM_SAMPLE_RATE,
    channels: QUICK_VOICE_PCM_CHANNELS,
    encoding: QUICK_VOICE_PCM_ENCODING,
    onBuffer(buffer: AudioStreamBuffer) {
      latestFormat.current = { sampleRate: buffer.sampleRate, channels: buffer.channels };
      if (overflowed.current) return;

      const chunk = copyBuffer(buffer.data);
      if (capturedBytes.current + chunk.byteLength > MAX_CAPTURE_BYTES) {
        overflowed.current = true;
        return;
      }
      capturedBytes.current += chunk.byteLength;
      chunks.current.push(chunk);
    },
  });

  function reset() {
    chunks.current = [];
    capturedBytes.current = 0;
    overflowed.current = false;
    latestFormat.current = { sampleRate: 0, channels: 0 };
    captureIdentity.current = null;
  }

  async function start() {
    reportQuickVoiceDebug('capture', 'started');
    reset();
    const createdAt = new Date().toISOString();
    captureIdentity.current = {
      localRef: `quick-voice-pcm://${Date.now()}-${Math.random().toString(36).slice(2, 12)}`,
      createdAt,
    };
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      throw new Error('마이크 권한이 필요합니다. 휴대폰 설정에서 업무수첩의 마이크 권한을 허용해주세요.');
    }
    await setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: true,
      allowsBackgroundRecording: false,
    });
    await stream.stream.start();
    reportQuickVoiceDebug('capture', 'succeeded');
  }

  async function stop(): Promise<QuickVoicePcmCapture> {
    await stream.stream.stop();
    await setAudioModeAsync({ allowsRecording: false });

    if (overflowed.current) {
      throw new Error('빠른 음성메모가 너무 깁니다. 짧게 나눠서 다시 말씀해주세요.');
    }

    const sampleRate = latestFormat.current.sampleRate || stream.stream.sampleRate;
    const channels = latestFormat.current.channels || stream.stream.channels;
    assertQuickVoicePcmFormat({ sampleRate, channels });

    const rawData = concatenatePcmBuffers(chunks.current);
    if (!rawData.byteLength) throw new Error('녹음된 PCM 데이터가 없습니다.');
    assertQuickVoiceSignal(analyzePcm16Signal(rawData));

    // This hook is used only by the Whisper fallback. Android live recognition
    // never records PCM, so its interim/final lifecycle remains untouched.
    const compacted = compactQuickVoicePcmSilence(rawData, sampleRate);
    const signal = analyzePcm16Signal(compacted.data);
    assertQuickVoiceSignal(signal);

    const identity = captureIdentity.current;
    if (!identity) throw new Error('Quick Voice PCM capture identity가 없습니다.');

    return createQuickVoicePcmAudioInput({
      localRef: identity.localRef,
      createdAt: identity.createdAt,
      data: compacted.data,
      sampleRate,
      channels,
      durationMs: compacted.processedDurationMs,
      signal,
    });
  }

  async function cancel() {
    try {
      await cancelQuickVoiceCapture({
        stopCapture: async () => { await stream.stream.stop(); },
        disableRecordingMode: () => setAudioModeAsync({ allowsRecording: false }),
        discardCapturedAudio: reset,
      });
    } catch (error) {
      reportQuickVoiceDebug('capture', 'failed', error);
      throw error;
    }
  }

  return Object.freeze({
    isStreaming: stream.isStreaming,
    stream: stream.stream,
    start,
    stop,
    cancel,
    reset,
  });
}
