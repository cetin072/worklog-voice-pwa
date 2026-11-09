import { meetingOwner, requireMeetingOwner } from './meeting-owner';
import { usePlatform } from '@/src/providers/platform-provider';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { createContext, type PropsWithChildren, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
  const { session } = usePlatform();
  const recordingOwner = useRef<string | null>(null);
  const pendingStart = useRef(false);
  const stopping = useRef(false);
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [phase, setPhase] = useState<MeetingRecorderPhase>('idle');
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [completed, setCompleted] = useState<MobileRecordingAudioInput | null>(null);
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [error, setError] = useState('');

  async function start() {
    if (phase !== 'idle' || pendingStart.current) return;
    pendingStart.current = true;
    setError('');
    try {
      const owner = requireMeetingOwner(session?.user.id);
      setCompleted(null);
      recordingOwner.current = owner;
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
      requireMeetingOwner(owner);
      const createdAt = new Date().toISOString();
      if (!recorder.uri) throw Error('녹음 경로를 확인하지 못했습니다. 다시 시작해주세요.');
      // Durable owner index BEFORE capture: restart can recover the same file,
      // never by assigning older unowned files to whoever logs in next.
      rememberMeetingRecording(createMobileRecordingAudioInput({ uri: recorder.uri, durationMs: 0, createdAt }), owner);
      recordingOwner.current = owner;
      recorder.record();

      setStartedAt(createdAt);
      setCompleted(null);
      setPhase('recording');
    } catch (nextError) {
      setPhase('idle');
      setError(messageOf(nextError, '녹음을 시작하지 못했습니다.'));
    } finally { pendingStart.current = false; }
  }

  function pause() {
    if (phase !== 'recording') return;
    requireMeetingOwner(recordingOwner.current || '');
    recorder.pause();
    setPhase('paused');
  }

  function resume() {
    if (phase !== 'paused') return;
    requireMeetingOwner(recordingOwner.current || '');
    recorder.record();
    setPhase('recording');
  }

  async function stop() {
    if (phase === 'idle' || phase === 'stopping' || stopping.current) return;
    stopping.current = true;
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
      if (!recordingOwner.current) throw Error('녹음 소유권을 확인하지 못했습니다. 원본은 보존했습니다.');
      rememberMeetingRecording(recording, recordingOwner.current);

      setCompleted(recording);
      setLibraryVersion((value) => value + 1);
      setStartedAt(null);
      setPhase('idle');
      // M4A and its verified index are already committed. A follow-up audio
      // mode reset failure must not be reported as a failed recording save.
      try {
        await setAudioModeAsync({
          allowsRecording: false,
          allowsBackgroundRecording: false,
        });
      } catch {
        setError('회의 녹음은 기기에 저장됐습니다. 재생할 때 오디오 설정을 다시 확인해주세요.');
      }
    } catch (nextError) {
      setPhase('idle');
      setError(messageOf(nextError, '녹음을 종료하지 못했습니다.'));
    } finally { stopping.current = false; }
  }

  useEffect(() => {
    if (recordingOwner.current && recordingOwner.current !== session?.user.id && phase !== 'idle') void stop();
  }, [session?.user.id, phase]);

  const visibleToCurrentOwner = recordingOwner.current === session?.user.id && meetingOwner() === session?.user.id;
  const value = useMemo<MeetingRecordingSessionValue>(() => Object.freeze({
    phase: visibleToCurrentOwner ? phase : 'idle',
    active: visibleToCurrentOwner && (phase === 'recording' || phase === 'paused' || phase === 'stopping'),
    durationMs: visibleToCurrentOwner ? Math.max(0, recorderState.durationMillis || 0) : 0,
    startedAt: visibleToCurrentOwner ? startedAt : null,
    completed: recordingOwner.current === session?.user.id && meetingOwner() === session?.user.id ? completed : null,
    libraryVersion,
    error: visibleToCurrentOwner ? error : '',
    start,
    pause,
    resume,
    stop,
    clearError: () => setError(''),
  }), [phase, recorderState.durationMillis, startedAt, completed, libraryVersion, error, session?.user.id, visibleToCurrentOwner]);

  return <MeetingRecordingSession.Provider value={value}>{children}</MeetingRecordingSession.Provider>;
}

export function useMeetingRecordingSession() {
  const value = useContext(MeetingRecordingSession);
  if (!value) throw new Error('useMeetingRecordingSession must be used inside MeetingRecordingProvider.');
  return value;
}
