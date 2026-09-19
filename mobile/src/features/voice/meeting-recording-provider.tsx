import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { createContext, type PropsWithChildren, useContext, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { createMobileRecordingAudioInput, type MobileRecordingAudioInput } from './audio-input';
import { rememberMeetingRecording } from './meeting-recordings';

const RECORDING_OPTIONS = { ...RecordingPresets.HIGH_QUALITY, directory: 'document' as const };

export type MeetingRecorderPhase = 'idle' | 'recording' | 'paused' | 'stopping';

type MeetingRecordingSessionValue = Readonly<{
  phase: MeetingRecorderPhase;
  active: boolean;
  durationMs: number;
  startedAt: string | null;
  completed: MobileRecordingAudioInput | null;
  libraryVersion: number;
  error: string;
  start(): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
  clearError(): void;
}>;

const MeetingRecordingSession = createContext<MeetingRecordingSessionValue | null>(null);

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function MeetingRecordingProvider({ children }: PropsWithChildren) {
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [phase, setPhase] = useState<MeetingRecorderPhase>('idle');
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [completed, setCompleted] = useState<MobileRecordingAudioInput | null>(null);
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [error, setError] = useState('');

  async function start() {
    if (phase !== 'idle') return;
    setError('');
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        throw new Error('마이크 권한이 필요합니다. Android 설정에서 업무수첩의 마이크 권한을 허용해주세요.');
      }
      if (Platform.OS === 'android') {
        const notificationPermission = await AudioModule.requestNotificationPermissionsAsync();
        if (!notificationPermission.granted) {
          throw new Error('백그라운드 녹음에는 알림 권한이 필요합니다. Android 설정에서 업무수첩의 알림을 허용해주세요.');
        }
      }

      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
        allowsBackgroundRecording: true,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();

      setStartedAt(new Date().toISOString());
      setCompleted(null);
      setPhase('recording');
    } catch (nextError) {
      setPhase('idle');
      setError(messageOf(nextError, '녹음을 시작하지 못했습니다.'));
    }
  }

  function pause() {
    if (phase !== 'recording') return;
    recorder.pause();
    setPhase('paused');
  }

  function resume() {
    if (phase !== 'paused') return;
    recorder.record();
    setPhase('recording');
  }

  async function stop() {
    if (phase === 'idle' || phase === 'stopping') return;
    setError('');
    setPhase('stopping');
    try {
      await recorder.stop();
      const status = await recorder.getStatus();
      const uri = recorder.uri || status.url;
      if (!uri) throw new Error('녹음은 종료됐지만 로컬 파일 경로를 확인하지 못했습니다.');

      const recording = createMobileRecordingAudioInput({
        uri,
        durationMs: status.durationMillis || recorderState.durationMillis,
        createdAt: startedAt || undefined,
      });
      rememberMeetingRecording(recording);

      setCompleted(recording);
      setLibraryVersion((value) => value + 1);
      setStartedAt(null);
      setPhase('idle');
      await setAudioModeAsync({
        allowsRecording: false,
        allowsBackgroundRecording: false,
      });
    } catch (nextError) {
      setPhase('idle');
      setError(messageOf(nextError, '녹음을 종료하지 못했습니다.'));
    }
  }

  const value = useMemo<MeetingRecordingSessionValue>(() => Object.freeze({
    phase,
    active: phase === 'recording' || phase === 'paused' || phase === 'stopping',
    durationMs: Math.max(0, recorderState.durationMillis || 0),
    startedAt,
    completed,
    libraryVersion,
    error,
    start,
    pause,
    resume,
    stop,
    clearError: () => setError(''),
  }), [phase, recorderState.durationMillis, startedAt, completed, libraryVersion, error]);

  return <MeetingRecordingSession.Provider value={value}>{children}</MeetingRecordingSession.Provider>;
}

export function useMeetingRecordingSession() {
  const value = useContext(MeetingRecordingSession);
  if (!value) throw new Error('useMeetingRecordingSession must be used inside MeetingRecordingProvider.');
  return value;
}
