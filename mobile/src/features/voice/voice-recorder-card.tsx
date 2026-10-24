import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Pressable, StyleSheet, Text, TextInput, Vibration, View } from 'react-native';

import { type QuickVoicePcmAudioInput } from '@/src/features/voice/audio-input';
import { createQuickVoiceDraftStorage } from '@/src/features/voice/quick-voice-draft';
import { createQuickVoiceClientRequestId, createQuickVoiceSaveAttempt, quickVoiceNeedsAttention, QuickVoiceFlowError, transcribeQuickVoiceCapture, type QuickVoiceFlowTimings } from '@/src/features/voice/quick-voice-flow';
import { MeetingRecordingLibrary } from '@/src/features/voice/meeting-recording-library';
import { useMeetingRecordingSession } from '@/src/features/voice/meeting-recording-provider';
import { useQuickVoicePcmCapture } from '@/src/features/voice/quick-voice-pcm';
import { createLiveSpeechTranscript, type MobileTranscriptV1, type MobileTranscriptionProvider } from '@/src/features/voice/transcription-provider';
import { createQuickVoiceRecognitionSession, type QuickVoiceRecognitionPort, type QuickVoiceRecognitionSession } from '@/src/features/voice/speech-recognition-session';
import { secureSessionStorage } from '@/src/platform/secure-storage';
import { mobileTheme } from '@/src/ui/theme';
import { reportQuickVoiceDebug } from '@/src/features/voice/quick-voice-debug';
import { QUICK_VOICE_LAYOUT } from '@/src/features/voice/quick-voice-layout';

type QuickVoicePhase = 'idle' | 'preparing' | 'recording' | 'captured' | 'transcribing' | 'saving' | 'refreshing' | 'saved' | 'transcript_error' | 'save_error' | 'refresh_error';
const SAVED_FEEDBACK_MS = 900;
type QuickVoiceSaveResult = Readonly<{ recordId?: string; scheduleDetected?: boolean; scheduleCreated?: boolean; scheduleId?: string; dueStart?: string }>;
type QuickVoiceProps = Readonly<{
  ensureProvider(onProgress?: (progress: { bytesWritten: number; totalBytes: number | null }) => void): Promise<MobileTranscriptionProvider>;
  speechRecognition?: QuickVoiceRecognitionPort;
  saveWorklog(transcript: string, options: { clientRequestId: string; recordedAt: string }): Promise<QuickVoiceSaveResult>;
  refreshBriefing(): Promise<unknown>;
  draftScope: string;
}>;
type VoiceRecorderCardProps = {
  mode?: 'quick';
  onOpenWorklogInput?: () => void;
  quickVoice?: QuickVoiceProps;
  navigationGuard?: { current: boolean };
  /** Test-only observer used by the Android release smoke to prove the real capture state transition. */
  onQuickVoicePhaseChange?: (phase: QuickVoicePhase) => void;
  /** CI can freeze only the elapsed-time repaint so Android UIAutomator can observe the recording UI. */
  freezeQuickVoiceTimer?: boolean;
} | {
  mode: 'meeting';
  onOpenWorklogInput?: () => void;
  quickVoice?: QuickVoiceProps;
  navigationGuard?: { current: boolean };
  onQuickVoicePhaseChange?: never;
  freezeQuickVoiceTimer?: never;
};

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
}
function messageOf(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }
function formatBytes(bytes: number) { return `${(Math.max(0, bytes) / (1024 * 1024)).toFixed(1)}MB`; }
function formatMs(ms: number | null) { return ms === null ? '-' : `${(Math.max(0, ms) / 1000).toFixed(2)}초`; }
function formatQuickVoicePcmDuration(audio: QuickVoicePcmAudioInput) {
  const original = audio.signal.originalDurationMs ?? audio.durationMs;
  const removed = audio.signal.removedSilenceMs ?? 0;
  return `PCM ${formatDuration(original)} → Whisper ${formatDuration(audio.durationMs)}${removed > 0 ? ` · 무음 정리 ${formatDuration(removed)}` : ''}`;
}
function formatSavedDue(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}
function quickStatus(phase: QuickVoicePhase) {
  return ({ idle: '대기', preparing: '녹음 준비 중', recording: '녹음 중', captured: '녹음 확인 중', transcribing: '한국어 전사 중', saving: '업무 저장 중', refreshing: '브리핑 새로고침 중', saved: '업무 저장 완료', transcript_error: '전사 재시도 필요', save_error: '저장 재시도 필요', refresh_error: '브리핑 새로고침 재시도 필요' } satisfies Record<QuickVoicePhase, string>)[phase];
}

export function VoiceRecorderCard({ mode = 'quick', onOpenWorklogInput, quickVoice, navigationGuard, onQuickVoicePhaseChange, freezeQuickVoiceTimer = false }: VoiceRecorderCardProps) {
  const meeting = useMeetingRecordingSession();
  const quickCapture = useQuickVoicePcmCapture();
  const [quickPhase, applyQuickPhase] = useState<QuickVoicePhase>('idle');
  const [quickAudio, setQuickAudio] = useState<QuickVoicePcmAudioInput | null>(null);
  const [quickTranscript, setQuickTranscript] = useState<MobileTranscriptV1 | null>(null);
  const [quickSave, setQuickSave] = useState<QuickVoiceSaveResult | null>(null);
  const [editableTranscript, setEditableTranscript] = useState('');
  const [modelDownload, setModelDownload] = useState<{ bytesWritten: number; totalBytes: number | null } | null>(null);
  const [providerPrepareMs, setProviderPrepareMs] = useState<number | null>(null);
  const [flowTimings, setFlowTimings] = useState<QuickVoiceFlowTimings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const recordingStartedAt = useRef<number | null>(null);
  const inFlight = useRef(false);
  const quickProvider = useRef<MobileTranscriptionProvider | null>(null);
  const speechSession = useRef<QuickVoiceRecognitionSession | null>(null);
  const [speechPreview, setSpeechPreview] = useState('');
  const clientRequestId = useRef<string | null>(null);
  // createQuickVoiceSaveAttempt retains the saveQuickVoiceTranscript payload across retries.
  const saveAttempt = useRef<ReturnType<typeof createQuickVoiceSaveAttempt<QuickVoiceSaveResult>> | null>(null);
  function setQuickPhase(phase: QuickVoicePhase) {
    // Update the parent guard synchronously, before awaiting capture or network.
    if (navigationGuard) navigationGuard.current = quickVoiceNeedsAttention(phase);
    onQuickVoicePhaseChange?.(phase);
    applyQuickPhase(phase);
  }

  const quickDraftScope = quickVoice?.draftScope?.trim() || '';

  function draftStorage() {
    if (!quickDraftScope) return null;
    return createQuickVoiceDraftStorage(secureSessionStorage, quickDraftScope);
  }

  async function clearQuickVoiceDraft() {
    try { await draftStorage()?.clear(); } catch { /* stale draft retries are still idempotent */ }
  }

  function savedFeedback() {
    try { Vibration.vibrate(120); } catch { /* feedback cannot change save truth */ }
  }

  function resetQuickVoiceToIdle() {
    clientRequestId.current = null;
    saveAttempt.current = null;
    recordingStartedAt.current = null;
    setRecordingElapsedMs(0);
    setError(null);
    setSpeechPreview('');
    setModelDownload(null);
    setProviderPrepareMs(null);
    setQuickAudio(null);
    setQuickTranscript(null);
    setQuickSave(null);
    setEditableTranscript('');
    setFlowTimings(null);
    setQuickPhase('idle');
  }

  useEffect(() => {
    if (quickPhase !== 'recording' || recordingStartedAt.current === null) return;
    if (freezeQuickVoiceTimer) return;
    const update = () => setRecordingElapsedMs(Math.max(0, Date.now() - Number(recordingStartedAt.current)));
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [freezeQuickVoiceTimer, quickPhase]);

  useEffect(() => {
    if (quickPhase !== 'saved') return;
    const timer = setTimeout(() => {
      if (inFlight.current) return;
      resetQuickVoiceToIdle();
    }, SAVED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [quickPhase]);

  useEffect(() => () => {
    // Leaving Home or recreating the screen must not leave an Android native
    // recognizer or its listeners alive behind the next Quick Voice session.
    speechSession.current?.dispose();
    speechSession.current = null;
  }, []);
  useEffect(() => {
    if (mode !== 'quick' || !quickVoice || !quickDraftScope) return;
    let cancelled = false;
    void (async () => {
      try {
        const draft = await draftStorage()?.load();
        if (!draft || cancelled || inFlight.current) return;
        clientRequestId.current = draft.clientRequestId;
        const onProgress = (stage: 'transcribing' | 'saving' | 'refreshing') => {
          if (stage !== 'transcribing') setQuickPhase(stage);
        };
        saveAttempt.current = createQuickVoiceSaveAttempt({
          transcript: draft.transcript,
          clientRequestId: draft.clientRequestId,
          recordedAt: draft.recordedAt,
          saveWorklog: quickVoice.saveWorklog,
          refreshBriefing: quickVoice.refreshBriefing,
          onProgress,
        });
        setQuickAudio(null);
        setQuickTranscript(draft.transcript);
        setQuickSave(null);
        setEditableTranscript(draft.transcript.text);
        setFlowTimings(null);
        setQuickPhase('save_error');
        setError('저장 전에 중단된 음성 기록을 복구했습니다. 같은 업무 다시 저장을 눌러 확인하세요.');
      } catch (nextError) {
        if (!cancelled) setError(messageOf(nextError, '이전 음성 임시 기록을 복구하지 못했습니다.'));
      }
    })();
    return () => { cancelled = true; };
    // Restore once for the signed-in account scope; the quickVoice object is intentionally not a dependency.
  }, [mode, quickDraftScope]);


  async function startQuickVoice() {
    if (!quickVoice || inFlight.current || quickPhase === 'recording') return;
    saveAttempt.current = null;
    inFlight.current = true; setError(null); setSpeechPreview(''); setModelDownload(null); setProviderPrepareMs(null); setFlowTimings(null); setQuickAudio(null); setQuickTranscript(null); setQuickSave(null); setEditableTranscript(''); setQuickPhase('preparing');
    try {
      if (quickVoice.speechRecognition) {
        clientRequestId.current = createQuickVoiceClientRequestId();
        const session = createQuickVoiceRecognitionSession(quickVoice.speechRecognition, {
          locale: 'ko-KR',
          onUpdate(snapshot) {
            setSpeechPreview([snapshot.committedText, snapshot.interimText].filter(Boolean).join(' '));
          },
          onFatalError(nextError) {
            speechSession.current?.dispose();
            speechSession.current = null;
            recordingStartedAt.current = null;
            setQuickPhase('transcript_error');
            setError(`${messageOf(nextError, '음성 인식을 계속할 수 없습니다.')} 기존 Whisper 경로로 다시 시도하거나 직접 입력할 수 있습니다.`);
          },
        });
        speechSession.current = session;
        try {
          await session.start();
          recordingStartedAt.current = Date.now();
          setRecordingElapsedMs(0);
          setQuickPhase('recording');
          return;
        } catch (recognitionError) {
          session.dispose();
          speechSession.current = null;
          setError(`${messageOf(recognitionError, 'Android 음성 인식을 사용할 수 없습니다.')} Whisper 음성 전사로 전환합니다.`);
        }
      }
      // Recording must be the first expensive action after the user taps the mic.
      // Whisper model download / verification / native initialization is deferred
      // until after capture so a slow first-use model can never block recording.
      await startWhisperCapture();
    } catch (nextError) {
      reportQuickVoiceDebug('capture', 'failed', nextError);
      setQuickPhase('idle');
      setError(messageOf(nextError, 'Quick Voice 녹음을 시작하지 못했습니다.'));
    } finally { inFlight.current = false; }
  }

  async function retryQuickVoiceSave() {
    if (!quickVoice || inFlight.current || !saveAttempt.current) return;
    inFlight.current = true; setError(null);
    try {
      const result = await saveAttempt.current.save();
      await clearQuickVoiceDraft();
      savedFeedback();
      setQuickTranscript(result.transcript); setQuickSave(result.saveResult); setEditableTranscript(result.transcript.text); setFlowTimings(result.timings);
      setQuickPhase(result.briefingRefreshError ? 'refresh_error' : 'saved');
      if (result.briefingRefreshError) setError(result.briefingRefreshError.message);
    } catch (nextError) {
      if (nextError instanceof QuickVoiceFlowError && nextError.stage === 'save') {
        setQuickTranscript(nextError.transcript);
        setEditableTranscript(nextError.transcript?.text || editableTranscript);
      }
      setQuickPhase('save_error');
      setError(messageOf(nextError, '음성 업무 저장을 확인하지 못했습니다.'));
    } finally { inFlight.current = false; }
  }

  async function stopQuickVoice() {
    if (quickPhase !== 'recording' || inFlight.current) return;
    const recognitionStartedAt = recordingStartedAt.current || Date.now();
    recordingStartedAt.current = null;
    inFlight.current = true; setError(null); setQuickPhase('captured');
    try {
      const session = speechSession.current;
      if (session) {
        const transcriptText = await session.stop();
        session.dispose();
        speechSession.current = null;
        await saveRecognizedSpeech(transcriptText, recognitionStartedAt);
      } else {
        const audio = await quickCapture.stop();
        setQuickAudio(audio);
        inFlight.current = false;
        await transcribeCapturedAudio(audio);
      }
    } catch (nextError) {
      setQuickPhase('transcript_error');
      setError(messageOf(nextError, '녹음된 음성을 확인하지 못했습니다.'));
    } finally {
      // SpeechRecognizer used to leave this latch true after both success and
      // empty-speech/error outcomes, making every recovery/new-recording button inert
      // until Home was remounted. Never carry the operation lock past Stop.
      inFlight.current = false;
    }
  }

  async function cancelQuickVoice() {
    if (quickPhase !== 'recording' || inFlight.current) return;
    inFlight.current = true;
    try {
      if (speechSession.current) {
        speechSession.current.cancel();
        speechSession.current.dispose();
        speechSession.current = null;
      } else await quickCapture.cancel();
    } catch {
      // The capture hook has already discarded chunks and attempted to restore
      // the audio mode. Cancellation never creates a transcript or save.
    } finally {
      clientRequestId.current = null;
      saveAttempt.current = null;
      recordingStartedAt.current = null;
      setRecordingElapsedMs(0);
      setError(null);
      setSpeechPreview(''); setQuickAudio(null);
      setQuickTranscript(null);
      setQuickSave(null);
      setEditableTranscript('');
      setFlowTimings(null);
      setQuickPhase('idle');
      inFlight.current = false;
    }
  }

  async function startWhisperCapture() {
    reportQuickVoiceDebug('capture', 'started');
    await quickCapture.start();
    reportQuickVoiceDebug('capture', 'succeeded');
    clientRequestId.current = createQuickVoiceClientRequestId();
    recordingStartedAt.current = Date.now();
    setRecordingElapsedMs(0);
    setQuickPhase('recording');
  }

  async function retryWhisperFallback() {
    if (!quickVoice || inFlight.current) return;
    inFlight.current = true;
    clientRequestId.current = null; saveAttempt.current = null; setSpeechPreview(''); setQuickAudio(null); setQuickTranscript(null); setQuickSave(null); setEditableTranscript(''); setFlowTimings(null); setError(null); setQuickPhase('preparing');
    try { await startWhisperCapture(); }
    catch (nextError) { setQuickPhase('transcript_error'); setError(messageOf(nextError, 'Whisper 음성 전사를 시작하지 못했습니다.')); }
    finally { inFlight.current = false; }
  }

  async function saveRecognizedSpeech(text: string, startedAt: number) {
    if (!quickVoice) return;
    if (!text.trim()) {
      // Silence is a normal user action, not a broken STT path. Save nothing and
      // immediately make Quick Voice ready for the next tap.
      resetQuickVoiceToIdle();
      return;
    }
    let recoveryWarning = '';
    try {
      const requestId = clientRequestId.current;
      const transcript = createLiveSpeechTranscript({
        text,
        language: 'ko-KR',
        provider: 'android-speech-recognition',
        sourceRef: `speech-recognition://${requestId || 'unknown'}`,
        createdAt: new Date(startedAt).toISOString(),
        durationMs: Math.max(0, Date.now() - startedAt),
      });
      setQuickTranscript(transcript); setEditableTranscript(transcript.text);
      setFlowTimings({ transcribeMs: 0, saveMs: 0, briefingRefreshMs: 0 });
      if (!requestId) throw new Error('Quick Voice 저장 요청 ID를 확인하지 못했습니다. 전사문은 보존했습니다.');
      try {
        await draftStorage()?.save({ version: 1, transcript, clientRequestId: requestId, recordedAt: transcript.createdAt });
      } catch { recoveryWarning = ' 기기 임시 복구 저장도 완료하지 못했습니다.'; }
      const onProgress = (stage: 'transcribing' | 'saving' | 'refreshing') => { if (stage !== 'transcribing') setQuickPhase(stage); };
      saveAttempt.current = createQuickVoiceSaveAttempt({ transcript, clientRequestId: requestId, recordedAt: transcript.createdAt, saveWorklog: quickVoice.saveWorklog, refreshBriefing: quickVoice.refreshBriefing, onProgress, transcribeMs: 0 });
      const saved = await saveAttempt.current.save();
      await clearQuickVoiceDraft();
      savedFeedback();
      setQuickTranscript(saved.transcript); setQuickSave(saved.saveResult); setEditableTranscript(saved.transcript.text); setFlowTimings(saved.timings);
      setQuickPhase(saved.briefingRefreshError ? 'refresh_error' : 'saved');
      if (saved.briefingRefreshError) setError(saved.briefingRefreshError.message);
    } catch (nextError) {
      if (nextError instanceof QuickVoiceFlowError && nextError.stage === 'save') {
        setQuickTranscript(nextError.transcript); setEditableTranscript(nextError.transcript?.text || editableTranscript); setQuickPhase('save_error');
        setError(`${messageOf(nextError, '음성 업무 저장을 확인하지 못했습니다.')}${recoveryWarning}`);
      } else { setQuickPhase('transcript_error'); setError(messageOf(nextError, '말한 내용을 찾지 못했습니다. 다시 말씀하거나 직접 입력해주세요.')); }
    }
  }

  async function transcribeCapturedAudio(audio: QuickVoicePcmAudioInput) {
    if (!quickVoice || inFlight.current) return;
    inFlight.current = true; setError(null); setQuickPhase('transcribing'); saveAttempt.current = null;
    let recoveryWarning = '';
    try {
      let provider = quickProvider.current;
      if (!provider) {
        reportQuickVoiceDebug('provider_prepare', 'started');
        const providerStartedAt = Date.now();
        try {
          provider = await quickVoice.ensureProvider((progress) => setModelDownload(progress));
          quickProvider.current = provider;
          setProviderPrepareMs(Math.max(0, Date.now() - providerStartedAt));
          reportQuickVoiceDebug('provider_prepare', 'succeeded');
        } catch (providerError) {
          reportQuickVoiceDebug('provider_prepare', 'failed', providerError);
          throw providerError;
        }
      }
      const result = await transcribeQuickVoiceCapture({ provider, audio });
      setQuickTranscript(result.transcript); setEditableTranscript(result.transcript.text);
      setFlowTimings({ transcribeMs: result.transcribeMs, saveMs: 0, briefingRefreshMs: 0 });

      const requestId = clientRequestId.current;
      if (!requestId) {
        setQuickPhase('save_error');
        setError('Quick Voice 저장 요청 ID를 확인하지 못했습니다. 전사문은 보존했습니다.');
        return;
      }

      try {
        await draftStorage()?.save({
          version: 1,
          transcript: result.transcript,
          clientRequestId: requestId,
          recordedAt: audio.createdAt,
        });
      } catch {
        recoveryWarning = ' 기기 임시 복구 저장도 완료하지 못했습니다.';
      }

      const onProgress = (stage: 'transcribing' | 'saving' | 'refreshing') => {
        if (stage !== 'transcribing') setQuickPhase(stage);
      };
      saveAttempt.current = createQuickVoiceSaveAttempt({
        transcript: result.transcript,
        clientRequestId: requestId,
        recordedAt: audio.createdAt,
        saveWorklog: quickVoice.saveWorklog,
        refreshBriefing: quickVoice.refreshBriefing,
        onProgress,
        transcribeMs: result.transcribeMs,
      });
      const saved = await saveAttempt.current.save();
      await clearQuickVoiceDraft();
      savedFeedback();
      setQuickTranscript(saved.transcript); setQuickSave(saved.saveResult); setEditableTranscript(saved.transcript.text); setFlowTimings(saved.timings);
      setQuickPhase(saved.briefingRefreshError ? 'refresh_error' : 'saved');
      if (saved.briefingRefreshError) setError(saved.briefingRefreshError.message);
    } catch (nextError) {
      if (nextError instanceof QuickVoiceFlowError && nextError.stage === 'save') {
        setQuickTranscript(nextError.transcript);
        setEditableTranscript(nextError.transcript?.text || editableTranscript);
        setQuickPhase('save_error');
        setError(`${messageOf(nextError, '음성 업무 저장을 확인하지 못했습니다.')}${recoveryWarning}`);
      } else {
        setQuickPhase('transcript_error');
        setError(messageOf(nextError, '음성 전사를 처리하지 못했습니다.'));
      }
    } finally { inFlight.current = false; }
  }

  function discardQuickVoice() {
    if (inFlight.current) return;
    const clear = async () => {
      await clearQuickVoiceDraft();
      clientRequestId.current = null; saveAttempt.current = null;
      speechSession.current?.cancel(); speechSession.current?.dispose(); speechSession.current = null;
      recordingStartedAt.current = null; setRecordingElapsedMs(0);
      setError(null); setSpeechPreview(''); setQuickAudio(null); setQuickTranscript(null); setQuickSave(null); setEditableTranscript(''); setFlowTimings(null); setQuickPhase('idle');
    };
    if (quickPhase === 'save_error') {
      Alert.alert('저장 결과 확인 필요', '서버에 이미 저장됐을 수 있습니다. 같은 업무 다시 저장으로 먼저 확인할 수 있습니다. 전사문을 버려도 서버 기록을 취소하지는 않습니다.', [
        { text: '돌아가기', style: 'cancel' }, { text: '전사문만 버리기', style: 'destructive', onPress: () => { void clear(); } },
      ]);
    } else void clear();
  }

  function openDirectInputFallback() {
    if (!onOpenWorklogInput || inFlight.current) return;
    void clearQuickVoiceDraft();
    clientRequestId.current = null; saveAttempt.current = null;
    speechSession.current?.cancel(); speechSession.current?.dispose(); speechSession.current = null;
    recordingStartedAt.current = null; setRecordingElapsedMs(0);
    setError(null); setSpeechPreview(''); setQuickAudio(null); setQuickTranscript(null); setQuickSave(null); setEditableTranscript(''); setFlowTimings(null);
    if (navigationGuard) navigationGuard.current = false;
    applyQuickPhase('idle');
    onOpenWorklogInput();
  }

  async function retryBriefing() {
    if (!quickVoice || inFlight.current) return;
    inFlight.current = true; setQuickPhase('refreshing'); setError(null);
    try { await quickVoice.refreshBriefing(); setQuickPhase('saved'); }
    catch (nextError) { setQuickPhase('refresh_error'); setError(messageOf(nextError, '브리핑을 새로고침하지 못했습니다.')); }
    finally { inFlight.current = false; }
  }

  const meetingActive = meeting.active;
  const quickActive = ['recording', 'preparing', 'captured', 'transcribing', 'saving', 'refreshing', 'save_error', 'transcript_error'].includes(quickPhase);

  if (mode === 'quick') {
    const canStart = !quickActive;
    const isRecording = quickPhase === 'recording';
    const statusDone = quickPhase === 'saved' || quickPhase === 'refresh_error';
    const statusText = isRecording
      ? `● 녹음 중 · ${formatDuration(recordingElapsedMs)}`
      : quickPhase === 'transcribing'
        ? '음성을 글자로 바꾸는 중…'
        : quickPhase === 'saving'
          ? '업무수첩에 저장하는 중…'
          : quickPhase === 'refreshing'
            ? '브리핑에 반영하는 중…'
            : quickPhase === 'saved'
              ? quickSave?.scheduleCreated ? '✓ 저장 완료 · 일정 반영' : '✓ 저장 완료'
              : quickStatus(quickPhase);
    const guidance = isRecording
      ? '말씀하세요. 끝나면 빨간 버튼을 누르세요.'
      : quickPhase === 'transcribing'
        ? '말한 내용을 초벌 글자로 바꾸고 있습니다.'
        : quickPhase === 'saving'
          ? '전사문을 안전하게 저장하고 있습니다.'
          : quickPhase === 'refreshing'
            ? '저장된 업무를 브리핑에 바로 반영하고 있습니다.'
            : null;

    return <View pointerEvents="box-none" style={styles.quickDock}>
      <View pointerEvents="none" style={styles.quickTopControl}>
        <View style={[styles.quickStatusBubble, isRecording ? styles.quickStatusBubbleRecording : statusDone ? styles.quickStatusBubbleDone : null]}>
          <Text style={[styles.quickStatusBubbleText, isRecording ? styles.quickStatusBubbleTextRecording : statusDone ? styles.quickStatusBubbleTextDone : null]}>{statusText}</Text>
        </View>
      </View>
      {quickPhase === 'transcribing' && modelDownload ? <Text style={styles.quickProgress}>음성 모델 받는 중 · {formatBytes(modelDownload.bytesWritten)}{modelDownload.totalBytes ? ` / ${formatBytes(modelDownload.totalBytes)}` : ''}</Text> : null}

      <View pointerEvents="box-none" style={styles.quickOrbitalRow}>
        {isRecording ? <Pressable accessibilityRole="button" accessibilityLabel="녹음 취소" style={[styles.quickAuxiliaryAction, styles.quickAuxiliaryActionLeft]} onPress={() => void cancelQuickVoice()}>
          <Text style={[styles.quickSideIcon, styles.quickCancelIcon]}>✕</Text>
          <Text style={[styles.quickSideLabel, styles.quickCancelLabel]}>취소</Text>
        </Pressable> : <Pressable accessibilityRole="button" accessibilityLabel="업무 직접 입력 열기" disabled={!onOpenWorklogInput || quickActive} style={[styles.quickAuxiliaryAction, styles.quickAuxiliaryActionLeft, quickActive ? styles.quickSideActionDisabled : null]} onPress={onOpenWorklogInput}>
          <Text style={styles.quickSideIcon}>✏️</Text>
          <Text style={styles.quickSideLabel}>메모</Text>
        </Pressable>}

        <View pointerEvents="box-none" style={styles.quickPrimaryControl}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isRecording ? '음성 기록 종료 후 바로 저장' : '음성 기록 시작'}
            disabled={quickActive && !isRecording}
            style={[styles.quickMic, isRecording ? styles.quickMicActive : null, quickActive && !isRecording ? styles.quickMicBusy : null]}
            onPress={() => void (isRecording ? stopQuickVoice() : canStart ? startQuickVoice() : undefined)}
          >
            <Text style={styles.quickMicIcon}>{isRecording ? '■' : '🎙'}</Text>
            <Text style={styles.quickMicLabel}>{isRecording ? '녹음 중' : quickActive ? '처리 중' : '음성 기록'}</Text>
            {isRecording ? <Text style={styles.quickMicTimer}>{formatDuration(recordingElapsedMs)}</Text> : null}
          </Pressable>
        </View>

        <View pointerEvents="none" style={[styles.quickAuxiliaryStatus, styles.quickAuxiliaryStatusRight]}>
          <Text style={styles.quickStatusIcon}>{statusDone ? '✓' : quickPhase === 'transcript_error' || quickPhase === 'save_error' ? '!' : '●'}</Text>
          <Text style={styles.quickSideLabel}>{statusDone ? '저장됨' : isRecording ? '녹음 중' : quickPhase === 'idle' ? '대기' : '처리 중'}</Text>
        </View>
      </View>

      {isRecording
        ? <Text numberOfLines={1} ellipsizeMode="tail" style={styles.quickGuidance}>{speechPreview || guidance}</Text>
        : guidance ? <Text numberOfLines={1} ellipsizeMode="tail" style={styles.quickGuidance}>{guidance}</Text> : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {quickPhase === 'transcript_error' && quickAudio ? <View style={styles.quickResult}><Text style={styles.quickResultTitle}>음성은 보존했습니다.</Text><Text style={styles.meta}>{formatQuickVoicePcmDuration(quickAudio)} · Peak {quickAudio.signal.peak.toFixed(3)} · RMS {quickAudio.signal.rms.toFixed(3)} · 유효 샘플 {(quickAudio.signal.nonZeroRatio * 100).toFixed(1)}%</Text><Button title="다시 전사" onPress={() => void transcribeCapturedAudio(quickAudio)} />{onOpenWorklogInput ? <Button title="업무 직접 입력" onPress={openDirectInputFallback} /> : null}</View> : null}
      {quickPhase === 'transcript_error' && !quickAudio ? <View style={styles.quickResult}><Text style={styles.quickResultTitle}>음성 인식 경로를 다시 시작할 수 없습니다.</Text><Button title="Whisper로 다시 녹음" onPress={() => void retryWhisperFallback()} />{onOpenWorklogInput ? <Button title="업무 직접 입력" onPress={openDirectInputFallback} /> : null}</View> : null}
      {quickPhase === 'transcript_error' ? <Button title="녹음 버리기" onPress={discardQuickVoice} /> : null}
      {quickPhase === 'save_error' && quickTranscript ? <View style={styles.quickResult}><Text style={styles.quickResultTitle}>{quickAudio ? '전사문을 보존했습니다.' : '이전 음성 기록을 복구했습니다.'}</Text><Text style={styles.meta}>저장 응답이 불확실해도 같은 요청 ID로 재시도합니다. 오타는 저장 확인 후 브리핑 카드의 ✏️에서 바로 수정할 수 있습니다.</Text><TextInput accessibilityLabel="보존된 전사문" multiline editable={false} style={styles.transcriptInput} value={editableTranscript} textAlignVertical="top" /><Button title="같은 업무 다시 저장" disabled={!saveAttempt.current} onPress={() => void retryQuickVoiceSave()} /><Button title="버리기" onPress={discardQuickVoice} /></View> : null}
      {quickPhase === 'refresh_error' ? <View style={styles.quickResult}><Text style={styles.quickResultTitle}>✅ 저장 완료 · 브리핑 갱신 실패</Text><Button title="브리핑만 다시 불러오기" onPress={() => void retryBriefing()} /></View> : null}
      {!quickActive && !quickTranscript && !error ? <Text style={styles.quickHint}>가운데 마이크를 누르면 바로 기록합니다.</Text> : null}
    </View>;
  }

  return <View style={styles.card}>
    <Text style={styles.sectionTitle}>회의 녹음</Text>
    <Text style={styles.body}>긴 회의도 로컬에 보존합니다. 화면을 잠그거나 다른 앱으로 이동해도 녹음이 계속됩니다.</Text>
    <View style={styles.statusRow}><Text style={styles.timer}>{formatDuration(meeting.durationMs)}</Text><Text style={styles.status}>{meeting.phase === 'recording' ? '녹음 중' : meeting.phase === 'paused' ? '일시정지' : meeting.phase === 'stopping' ? '저장 중' : '대기'}</Text></View>
    {!meetingActive ? <Button title="녹음 시작" onPress={() => void meeting.start()} /> : null}
    {meeting.phase === 'recording' ? <Button title="일시정지" onPress={meeting.pause} /> : null}
    {meeting.phase === 'paused' ? <Button title="녹음 재개" onPress={meeting.resume} /> : null}
    {meetingActive ? <Button title={meeting.phase === 'stopping' ? '저장 중...' : '녹음 종료'} disabled={meeting.phase === 'stopping'} onPress={() => void meeting.stop()} /> : null}
    {meetingActive ? <Text style={styles.notice}>Android에서는 녹음 중 시스템의 지속 알림이 표시됩니다. 홈으로 돌아가도 녹음 상태를 확인할 수 있습니다.</Text> : null}
    {meeting.error ? <Text style={styles.errorText}>{meeting.error}</Text> : null}
    {meeting.completed ? <View style={styles.result}><Text style={styles.resultTitle}>✅ 회의 녹음 파일 저장 완료</Text><Text style={styles.meta}>파일: {meeting.completed.fileName}</Text><Text style={styles.meta}>길이: {formatDuration(meeting.completed.durationMs)}</Text><Text style={styles.meta}>형식: {meeting.completed.mimeType}</Text><Text style={styles.notice}>회의 녹음 파일은 기기에 보존됐습니다. 아래 목록에서 바로 재생할 수 있습니다.</Text></View> : null}
    <MeetingRecordingLibrary refreshToken={meeting.libraryVersion} />
  </View>;
}

const styles = StyleSheet.create({
  quickDock: { width: QUICK_VOICE_LAYOUT.dockWidth, height: QUICK_VOICE_LAYOUT.dockHeight, alignSelf: 'center', position: 'relative', backgroundColor: 'transparent' },
  quickTopControl: { position: 'absolute', top: 0, left: 0, right: 0, height: QUICK_VOICE_LAYOUT.timerSize, alignItems: 'center', justifyContent: 'center' },
  quickStatusBubble: { minHeight: QUICK_VOICE_LAYOUT.timerSize, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(241,245,249,0.94)', shadowColor: '#111827', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 4 },
  quickStatusBubbleRecording: { backgroundColor: '#b91c1c' },
  quickStatusBubbleDone: { backgroundColor: '#eaf4ea' },
  quickStatusBubbleText: { fontSize: 12, fontWeight: '900', color: '#475569' },
  quickStatusBubbleTextRecording: { color: '#fff' },
  quickStatusBubbleTextDone: { color: mobileTheme.colors.success },
  quickProgress: { position: 'absolute', top: QUICK_VOICE_LAYOUT.timerSize + 4, left: 8, right: 8, textAlign: 'center', fontSize: 11, color: '#475569' },
  quickOrbitalRow: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  quickPrimaryControl: { position: 'absolute', left: (QUICK_VOICE_LAYOUT.dockWidth - QUICK_VOICE_LAYOUT.micSize) / 2, bottom: 0, width: QUICK_VOICE_LAYOUT.micSize, height: QUICK_VOICE_LAYOUT.micSize, alignItems: 'center', justifyContent: 'center' },
  quickMic: { width: QUICK_VOICE_LAYOUT.micSize, height: QUICK_VOICE_LAYOUT.micSize, borderRadius: QUICK_VOICE_LAYOUT.micSize / 2, alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: mobileTheme.colors.primary, borderWidth: 5, borderColor: mobileTheme.colors.surface, shadowColor: mobileTheme.colors.primary, shadowOpacity: 0.28, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  quickMicActive: { backgroundColor: '#b91c1c', shadowColor: '#b91c1c', shadowOpacity: 0.34 },
  quickMicBusy: { opacity: 0.65 },
  quickMicIcon: { fontSize: 34, color: '#fff' },
  quickMicLabel: { fontSize: 13, fontWeight: '900', color: '#fff' },
  quickMicTimer: { fontSize: 13, fontWeight: '900', color: '#fff', fontVariant: ['tabular-nums'] },
  quickAuxiliaryAction: { position: 'absolute', bottom: QUICK_VOICE_LAYOUT.sideActionBottom, width: QUICK_VOICE_LAYOUT.sideActionSize, height: QUICK_VOICE_LAYOUT.sideActionSize, borderRadius: QUICK_VOICE_LAYOUT.sideActionSize / 2, alignItems: 'center', justifyContent: 'center', gap: 1, borderWidth: 1, borderColor: mobileTheme.colors.border, backgroundColor: 'rgba(255,255,255,0.96)', shadowColor: '#111827', shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  quickAuxiliaryActionLeft: { left: 0 },
  quickSideActionDisabled: { opacity: 0.4 },
  quickAuxiliaryStatus: { position: 'absolute', bottom: QUICK_VOICE_LAYOUT.sideActionBottom, width: QUICK_VOICE_LAYOUT.sideActionSize, height: QUICK_VOICE_LAYOUT.sideActionSize, borderRadius: QUICK_VOICE_LAYOUT.sideActionSize / 2, alignItems: 'center', justifyContent: 'center', gap: 1, borderWidth: 1, borderColor: mobileTheme.colors.border, backgroundColor: 'rgba(248,250,252,0.96)' },
  quickAuxiliaryStatusRight: { right: 0 },
  quickSideIcon: { fontSize: 18 },
  quickCancelIcon: { color: '#b91c1c', fontWeight: '900' },
  quickCancelLabel: { color: '#b91c1c' },
  quickStatusIcon: { fontSize: 16, fontWeight: '900', color: '#245c2a' },
  quickSideLabel: { fontSize: 10, fontWeight: '800', color: '#374151' },
  quickHint: { display: 'none' },
  quickGuidance: { position: 'absolute', top: QUICK_VOICE_LAYOUT.timerSize + 5, left: 8, right: 8, textAlign: 'center', fontSize: 12, fontWeight: '700', color: mobileTheme.colors.textSecondary, lineHeight: 18 },
  quickResult: { position: 'absolute', left: 0, right: 0, bottom: QUICK_VOICE_LAYOUT.dockHeight + 10, gap: 6, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: mobileTheme.colors.border, backgroundColor: 'rgba(255,255,255,0.98)', shadowColor: '#111827', shadowOpacity: 0.16, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  quickResultTitle: { textAlign: 'center', fontSize: 12, fontWeight: '800', color: mobileTheme.colors.success },
  card: { backgroundColor: mobileTheme.colors.surface, borderRadius: mobileTheme.radius.card, padding: mobileTheme.spacing.card, gap: 14 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: mobileTheme.colors.text },
  body: { fontSize: 14, color: mobileTheme.colors.textSecondary, lineHeight: 20 },
  statusRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  timer: { fontSize: 30, fontWeight: '800', color: '#17191d', fontVariant: ['tabular-nums'] },
  status: { fontSize: 14, fontWeight: '700', color: '#4b515c' },
  notice: { fontSize: 12, color: '#737985', lineHeight: 18 },
  errorText: { position: 'absolute', left: 6, right: 6, bottom: QUICK_VOICE_LAYOUT.dockHeight + 8, padding: 10, borderRadius: 12, backgroundColor: '#fff1f2', color: mobileTheme.colors.danger, lineHeight: 18, fontSize: 12 },
  result: { borderWidth: 1, borderColor: '#e0e3e8', borderRadius: 12, padding: 14, gap: 8 },
  resultTitle: { fontSize: 15, fontWeight: '700', color: '#17191d' },
  meta: { fontSize: 11, color: '#737985', lineHeight: 16 },
  scheduleSuccess: { fontSize: 13, fontWeight: '800', color: mobileTheme.colors.link, lineHeight: 19, textAlign: 'center' },
  scheduleNeutral: { fontSize: 12, color: mobileTheme.colors.textMuted, lineHeight: 18, textAlign: 'center' },
  transcript: { fontSize: 14, color: '#30343b', lineHeight: 20 },
  transcriptInput: { minHeight: 90, maxHeight: 150, borderWidth: 1, borderColor: '#cfd5dd', borderRadius: 10, padding: 10, fontSize: 14, color: '#30343b' },
});
