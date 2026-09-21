import { useEffect, useState } from 'react';
import { Buffer } from 'buffer';
import { StyleSheet, Text, View } from 'react-native';

import { PRE_HUMAN_PCM_BASE64 } from '@/src/qa/pre-human-audio-fixture';
import { createQuickVoicePcmAudioInput } from '@/src/features/voice/audio-input';
import {
  prepareQuickVoiceWhisperProvider,
  releaseQuickVoiceWhisperProvider,
} from '@/src/features/voice/providers/whisper-rn-quick-voice-runtime';
import { transcribeQuickVoice } from '@/src/features/voice/transcription-provider';

type State =
  | { phase: 'running'; detail: string }
  | { phase: 'pass'; transcript: string; detail: string }
  | { phase: 'fail'; detail: string };

function decodePcm16Base64(value: string) {
  const source = Buffer.from(value, 'base64');
  if (!source.byteLength || source.byteLength % 2 !== 0) {
    throw new Error('QA PCM16 fixture가 비어 있거나 byte 정렬이 올바르지 않습니다.');
  }
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy.buffer;
}

function signalOf(data: ArrayBuffer) {
  const view = new DataView(data);
  let peak = 0;
  let energy = 0;
  let nonZero = 0;
  const samples = data.byteLength / 2;
  for (let offset = 0; offset < data.byteLength; offset += 2) {
    const normalized = view.getInt16(offset, true) / 32768;
    const magnitude = Math.abs(normalized);
    peak = Math.max(peak, magnitude);
    energy += normalized * normalized;
    if (magnitude > 0.001) nonZero += 1;
  }
  return {
    peak,
    rms: Math.sqrt(energy / Math.max(1, samples)),
    nonZeroRatio: nonZero / Math.max(1, samples),
  };
}

export default function PreHumanNativeSttScreen() {
  const [state, setState] = useState<State>({ phase: 'running', detail: '한국어 PCM 준비 중' });

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        if (!PRE_HUMAN_PCM_BASE64) throw new Error('QA fixture가 생성되지 않았습니다.');
        const data = decodePcm16Base64(PRE_HUMAN_PCM_BASE64);
        const durationMs = Math.round((data.byteLength / 2 / 16_000) * 1000);
        const signal = signalOf(data);
        if (signal.rms < 0.001 || signal.nonZeroRatio < 0.01) {
          throw new Error(`QA 음성 신호가 너무 작습니다. RMS=${signal.rms.toFixed(4)} nonZero=${signal.nonZeroRatio.toFixed(4)}`);
        }

        if (alive) setState({ phase: 'running', detail: `Whisper 모델 준비 중 · PCM ${durationMs}ms` });
        const provider = await prepareQuickVoiceWhisperProvider((progress) => {
          if (!alive) return;
          const total = progress.totalBytes || 0;
          const percent = total > 0 ? Math.floor((progress.bytesWritten / total) * 100) : 0;
          setState({ phase: 'running', detail: `Whisper 모델 준비 중 · ${percent}%` });
        });

        if (alive) setState({ phase: 'running', detail: 'whisper.rn native transcribeData 실행 중' });
        const transcript = await transcribeQuickVoice(
          provider,
          createQuickVoicePcmAudioInput({
            localRef: 'qa://pre-human-korean-pcm',
            data,
            sampleRate: 16_000,
            channels: 1,
            durationMs,
            signal,
            createdAt: '2026-09-20T09:00:00.000Z',
          }),
          'ko',
        );

        if (!/[가-힣]/.test(transcript.text)) {
          throw new Error(`한국어 음성에서 한글 transcript를 얻지 못했습니다: ${transcript.text}`);
        }
        console.log('[PREHUMAN_STT_PASS]', JSON.stringify({
          transcript: transcript.text,
          provider: transcript.provider,
          model: transcript.model,
          durationMs,
          signal,
        }));
        if (alive) {
          setState({
            phase: 'pass',
            transcript: transcript.text,
            detail: `${transcript.provider} · ${transcript.model} · ${durationMs}ms`,
          });
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'unknown_error';
        console.error('[PREHUMAN_STT_FAIL]', detail);
        if (alive) setState({ phase: 'fail', detail });
      }
    })();

    return () => {
      alive = false;
      void releaseQuickVoiceWhisperProvider().catch(() => undefined);
    };
  }, []);

  return <View style={styles.page}>
    <Text accessibilityRole="header" style={styles.title}>Pre-Human Native STT</Text>
    {state.phase === 'running' ? <>
      <Text style={styles.running}>PREHUMAN STT RUNNING</Text>
      <Text style={styles.detail}>{state.detail}</Text>
    </> : null}
    {state.phase === 'pass' ? <>
      <Text style={styles.pass}>PREHUMAN STT PASS</Text>
      <Text style={styles.transcript}>{state.transcript}</Text>
      <Text style={styles.detail}>{state.detail}</Text>
    </> : null}
    {state.phase === 'fail' ? <>
      <Text style={styles.fail}>PREHUMAN STT FAIL</Text>
      <Text style={styles.detail}>{state.detail}</Text>
    </> : null}
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: 'center', padding: 24, gap: 14, backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: '800', color: '#111827' },
  running: { fontSize: 18, fontWeight: '800', color: '#1d4ed8' },
  pass: { fontSize: 20, fontWeight: '900', color: '#166534' },
  fail: { fontSize: 20, fontWeight: '900', color: '#b91c1c' },
  transcript: { fontSize: 18, lineHeight: 28, color: '#111827' },
  detail: { fontSize: 13, lineHeight: 20, color: '#4b5563' },
});
