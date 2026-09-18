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

    const data = concatenatePcmBuffers(chunks.current);
    if (!data.byteLength) throw new Error('녹음된 PCM 데이터가 없습니다.');

    const bytesPerSample = 2;
    const samplesPerChannel = data.byteLength / bytesPerSample / channels;
    const durationMs = Math.round(samplesPerChannel / sampleRate * 1000);

    const identity = captureIdentity.current;
    if (!identity) throw new Error('Quick Voice PCM capture identity가 없습니다.');

    return createQuickVoicePcmAudioInput({
      localRef: identity.localRef,
      createdAt: identity.createdAt,
      data,
      sampleRate,
      channels,
      durationMs,
    });
  }

  return Object.freeze({
    isStreaming: stream.isStreaming,
    stream: stream.stream,
    start,
    stop,
    reset,
  });
}
