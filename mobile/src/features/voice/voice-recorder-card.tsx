import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useState } from 'react';
import { Button, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  createMobileRecordingAudioInput,
  type MobileRecordingAudioInput,
} from '@/src/features/voice/audio-input';

const RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  directory: 'document' as const,
};

type RecorderPhase = 'idle' | 'recording' | 'paused' | 'stopping';

type VoiceRecorderCardProps = {
  mode?: 'quick' | 'meeting';
  onOpenWorklogInput?: () => void;
};

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function VoiceRecorderCard({ mode = 'quick', onOpenWorklogInput }: VoiceRecorderCardProps) {
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

      if (Platform.OS === 'android') {
        const notificationPermission = await AudioModule.requestNotificationPermissionsAsync();
        if (!notificationPermission.granted) {
          setError('백그라운드 녹음에는 알림 권한이 필요합니다. Android 설정에서 업무수첩의 알림을 허용해주세요.');
          return;
        }
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

  if (mode === 'quick') {
    return <View style={styles.quickDock}>
      {active ? <View style={styles.quickTimerBubble}><Text style={styles.quickTimer}>{formatDuration(recorderState.durationMillis)}</Text><Text style={styles.quickTimerState}>{phase === 'stopping' ? '저장 중' : '녹음 중'}</Text></View> : null}

      <View style={styles.quickControls}>
        <Pressable accessibilityRole="button" accessibilityLabel="업무 직접 입력 열기" disabled={!onOpenWorklogInput || active} style={[styles.quickSideAction, active ? styles.quickSideActionDisabled : null]} onPress={onOpenWorklogInput}>
          <Text style={styles.quickSideIcon}>✏️</Text>
          <Text style={styles.quickSideLabel}>메모</Text>
        </Pressable>

        <Pressable accessibilityRole="button" accessibilityLabel={active ? '음성 기록 종료 후 저장' : '음성 기록 시작'} disabled={phase === 'stopping'} style={[styles.quickMic, active ? styles.quickMicActive : null]} onPress={() => void (active ? stopRecording() : startRecording())}>
          <Text style={styles.quickMicIcon}>{active ? '■' : '🎙'}</Text>
          <Text style={styles.quickMicLabel}>{phase === 'stopping' ? '저장 중' : active ? '종료' : '음성 기록'}</Text>
        </Pressable>

        <View style={styles.quickSideStatus}>
          <Text style={styles.quickStatusIcon}>{completed ? '✓' : '●'}</Text>
          <Text style={styles.quickSideLabel}>{completed ? '저장됨' : active ? '녹음 중' : '대기'}</Text>
        </View>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {completed ? <View style={styles.quickResult}>
        <Text style={styles.quickResultTitle}>✅ 음성 메모 파일 저장 완료</Text>
        <Text style={styles.meta}>{formatDuration(completed.durationMs)} · {completed.fileName}</Text>
        <Text style={styles.notice}>현재는 기기 파일 저장 단계입니다. 업무·브리핑 자동 등록은 Quick Voice STT 단계에서 연결합니다.</Text>
      </View> : <Text style={styles.quickHint}>{active ? '말씀을 마치면 가운데 종료를 누르세요.' : '가운데 마이크를 누르면 바로 녹음합니다.'}</Text>}
    </View>;
  }

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{mode === 'meeting' ? '회의 녹음' : '빠른 음성 메모'}</Text>
      <Text style={styles.body}>
        {mode === 'meeting'
          ? '긴 회의도 로컬에 보존합니다. 화면을 잠그거나 다른 앱으로 이동해도 녹음이 계속됩니다.'
          : '짧은 업무 메모를 바로 녹음해 기기에 저장합니다. 자동 업로드하지 않습니다.'}
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
      {mode === 'meeting' && phase === 'recording' ? <Button title="일시정지" onPress={pauseRecording} /> : null}
      {mode === 'meeting' && phase === 'paused' ? <Button title="녹음 재개" onPress={resumeRecording} /> : null}
      {active ? (
        <Button title={phase === 'stopping' ? '저장 중...' : '녹음 종료'} disabled={phase === 'stopping'} onPress={stopRecording} />
      ) : null}

      {active ? (
        <Text style={styles.notice}>Android에서는 녹음 중 시스템의 지속 알림이 표시됩니다.</Text>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {completed ? (
        <View style={styles.result}>
          <Text style={styles.resultTitle}>✅ 음성 메모 파일 저장 완료</Text>
          <Text style={styles.meta}>파일: {completed.fileName}</Text>
          <Text style={styles.meta}>길이: {formatDuration(completed.durationMs)}</Text>
          <Text style={styles.meta}>형식: {completed.mimeType}</Text>
          <Text style={styles.meta}>입력: {completed.sourceKind}</Text>
          <Text style={styles.notice}>이 녹음 파일은 기기에 보존됐습니다. 업무 기록·브리핑에는 자동 등록되지 않습니다.</Text>
          {mode === 'quick' && onOpenWorklogInput ? <Button title="업무 직접 입력으로 기록하기" onPress={onOpenWorklogInput} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  quickDock: {
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e1e5ea',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 8,
  },
  quickControls: {
    minHeight: 92,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 22,
  },
  quickMic: {
    width: 104,
    height: 104,
    marginTop: -28,
    borderRadius: 52,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    backgroundColor: '#111827',
    borderWidth: 5,
    borderColor: '#fff',
    shadowColor: '#111827',
    shadowOpacity: 0.24,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  quickMicActive: { backgroundColor: '#b42318' },
  quickMicIcon: { fontSize: 28, color: '#fff' },
  quickMicLabel: { fontSize: 13, fontWeight: '900', color: '#fff' },
  quickSideAction: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderWidth: 1,
    borderColor: '#d7dae0',
    backgroundColor: '#fff',
  },
  quickSideActionDisabled: { opacity: 0.4 },
  quickSideStatus: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderWidth: 1,
    borderColor: '#d7dae0',
    backgroundColor: '#f8fafc',
  },
  quickSideIcon: { fontSize: 19 },
  quickStatusIcon: { fontSize: 16, fontWeight: '900', color: '#245c2a' },
  quickSideLabel: { fontSize: 10, fontWeight: '800', color: '#374151' },
  quickTimerBubble: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: -4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#111827',
  },
  quickTimer: { fontSize: 13, fontWeight: '900', color: '#fff', fontVariant: ['tabular-nums'] },
  quickTimerState: { fontSize: 11, fontWeight: '800', color: '#e5e7eb' },
  quickHint: { textAlign: 'center', fontSize: 11, color: '#737985', lineHeight: 16 },
  quickResult: { gap: 3, paddingHorizontal: 4, paddingBottom: 2 },
  quickResultTitle: { textAlign: 'center', fontSize: 12, fontWeight: '800', color: '#245c2a' },
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
