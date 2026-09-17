import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';

import {
  createMobileRecordingAudioInput,
  type MobileRecordingAudioInput,
} from '@/src/features/voice/audio-input';

const RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  directory: 'document' as const,
};

type RecorderPhase = 'idle' | 'recording' | 'paused' | 'stopping';

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function VoiceRecorderCard() {
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [recordingStartedAt, setRecordingStartedAt] = useState<string | null>(null);
  const [completed, setCompleted] = useState<MobileRecordingAudioInput | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startRecording() {
    setError(null);

    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError('마이크 권한이 필요합니다. Android 설정에서 업무수첩의 마이크 권한을 허용해주세요.');
        return;
      }

      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
        allowsBackgroundRecording: true,
      });

      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecordingStartedAt(new Date().toISOString());
      setCompleted(null);
      setPhase('recording');
    } catch (nextError) {
      setPhase('idle');
      setError(nextError instanceof Error ? nextError.message : '녹음을 시작하지 못했습니다.');
    }
  }

  function pauseRecording() {
    setError(null);
    try {
      recorder.pause();
      setPhase('paused');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '녹음을 일시정지하지 못했습니다.');
    }
  }

  function resumeRecording() {
    setError(null);
    try {
      recorder.record();
      setPhase('recording');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '녹음을 재개하지 못했습니다.');
    }
  }

  async function stopRecording() {
    if (phase === 'idle' || phase === 'stopping') return;

    setError(null);
    setPhase('stopping');

    try {
      await recorder.stop();
      const status = await recorder.getStatus();
      const uri = recorder.uri || status.url;
      if (!uri) {
        throw new Error('녹음은 종료됐지만 로컬 파일 경로를 확인하지 못했습니다.');
      }

      const audioInput = createMobileRecordingAudioInput({
        uri,
        durationMs: status.durationMillis || recorderState.durationMillis,
        createdAt: recordingStartedAt || undefined,
      });

      setCompleted(audioInput);
      setRecordingStartedAt(null);
      setPhase('idle');
      await setAudioModeAsync({
        allowsRecording: false,
        allowsBackgroundRecording: false,
      });
    } catch (nextError) {
      setPhase('idle');
      setError(nextError instanceof Error ? nextError.message : '녹음을 종료하지 못했습니다.');
    }
  }

  const active = phase === 'recording' || phase === 'paused' || phase === 'stopping';

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>음성 녹음</Text>
      <Text style={styles.body}>
        직접 시작한 녹음만 기기에 저장합니다. 화면을 잠그거나 다른 앱으로 이동해도 녹음이 계속됩니다.
      </Text>

      <View style={styles.statusRow}>
        <Text style={styles.timer}>{formatDuration(recorderState.durationMillis)}</Text>
        <Text style={styles.status}>
          {phase === 'recording'
            ? '녹음 중'
            : phase === 'paused'
              ? '일시정지'
              : phase === 'stopping'
                ? '저장 중'
                : '대기'}
        </Text>
      </View>

      {!active ? <Button title="녹음 시작" onPress={startRecording} /> : null}
      {phase === 'recording' ? <Button title="일시정지" onPress={pauseRecording} /> : null}
      {phase === 'paused' ? <Button title="녹음 재개" onPress={resumeRecording} /> : null}
      {active ? (
        <Button title={phase === 'stopping' ? '저장 중...' : '녹음 종료'} disabled={phase === 'stopping'} onPress={stopRecording} />
      ) : null}

      {active ? (
        <Text style={styles.notice}>Android에서는 녹음 중 시스템의 지속 알림이 표시됩니다.</Text>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {completed ? (
        <View style={styles.result}>
          <Text style={styles.resultTitle}>로컬 녹음 저장 완료</Text>
          <Text style={styles.meta}>파일: {completed.fileName}</Text>
          <Text style={styles.meta}>길이: {formatDuration(completed.durationMs)}</Text>
          <Text style={styles.meta}>형식: {completed.mimeType}</Text>
          <Text style={styles.meta}>입력: {completed.sourceKind}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 20,
    gap: 14,
  },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#17191d' },
  body: { fontSize: 14, color: '#4b515c', lineHeight: 20 },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  timer: { fontSize: 30, fontWeight: '800', color: '#17191d', fontVariant: ['tabular-nums'] },
  status: { fontSize: 14, fontWeight: '700', color: '#4b515c' },
  notice: { fontSize: 12, color: '#737985', lineHeight: 18 },
  errorText: { color: '#b42318', lineHeight: 20 },
  result: {
    borderWidth: 1,
    borderColor: '#e0e3e8',
    borderRadius: 12,
    padding: 14,
    gap: 5,
  },
  resultTitle: { fontSize: 15, fontWeight: '700', color: '#17191d' },
  meta: { fontSize: 12, color: '#737985' },
});
