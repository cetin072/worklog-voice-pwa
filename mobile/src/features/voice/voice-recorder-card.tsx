import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { Button, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { createMobileRecordingAudioInput, type MobileRecordingAudioInput, type QuickVoicePcmAudioInput } from '@/src/features/voice/audio-input';
import { createQuickVoiceClientRequestId, QuickVoiceFlowError, runQuickVoiceFastPath, saveQuickVoiceTranscript, type QuickVoiceFlowTimings } from '@/src/features/voice/quick-voice-flow';
import { MeetingRecordingLibrary } from '@/src/features/voice/meeting-recording-library';
import { rememberMeetingRecording } from '@/src/features/voice/meeting-recordings';
import { useQuickVoicePcmCapture } from '@/src/features/voice/quick-voice-pcm';
import type { MobileTranscriptV1, MobileTranscriptionProvider } from '@/src/features/voice/transcription-provider';
import { mobileTheme } from '@/src/ui/theme';

const RECORDING_OPTIONS = { ...RecordingPresets.HIGH_QUALITY, directory: 'document' as const };
type RecorderPhase = 'idle' | 'recording' | 'paused' | 'stopping';
type QuickVoicePhase = 'idle' | 'preparing' | 'recording' | 'captured' | 'transcribing' | 'saving' | 'refreshing' | 'saved' | 'transcript_error' | 'save_error' | 'refresh_error';
type QuickVoiceSaveResult = Readonly<{ recordId?: string }>;
type QuickVoiceProps = Readonly<{
  ensureProvider(onProgress?: (progress: { bytesWritten: number; totalBytes: number | null }) => void): Promise<MobileTranscriptionProvider>;
  releaseProvider?(): Promise<void>;
  saveWorklog(transcript: string, options: { clientRequestId: string; recordedAt: string }): Promise<QuickVoiceSaveResult>;
  refreshBriefing(): Promise<unknown>;
  updateSavedWorklog?(recordId: string, transcript: string): Promise<unknown>;
}>;
type VoiceRecorderCardProps = { mode?: 'quick' | 'meeting'; onOpenWorklogInput?: () => void; quickVoice?: QuickVoiceProps };

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
}
function messageOf(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }
function formatBytes(bytes: number) { return `${(Math.max(0, bytes) / (1024 * 1024)).toFixed(1)}MB`; }
function formatMs(ms: number | null) { return ms === null ? '-' : `${(Math.max(0, ms) / 1000).toFixed(2)}초`; }
function quickStatus(phase: QuickVoicePhase) {
  return ({ idle: '대기', preparing: '음성 모델 준비 중', recording: '녹음 중', captured: '녹음 확인 중', transcribing: '한국어 전사 중', saving: '업무 저장 중', refreshing: '브리핑 새로고침 중', saved: '업무 저장 완료', transcript_error: '전사 재시도 필요', save_error: '저장 재시도 필요', refresh_error: '브리핑 새로고침 재시도 필요' } satisfies Record<QuickVoicePhase, string>)[phase];
}

export function VoiceRecorderCard({ mode = 'quick', onOpenWorklogInput, quickVoice }: VoiceRecorderCardProps) {
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 250);
  const quickCapture = useQuickVoicePcmCapture();
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [quickPhase, setQuickPhase] = useState<QuickVoicePhase>('idle');
  const [recordingStartedAt, setRecordingStartedAt] = useState<string | null>(null);
  const [completed, setCompleted] = useState<MobileRecordingAudioInput | null>(null);
  const [meetingLibraryVersion, setMeetingLibraryVersion] = useState(0);
  const [quickAudio, setQuickAudio] = useState<QuickVoicePcmAudioInput | null>(null);
  const [quickTranscript, setQuickTranscript] = useState<MobileTranscriptV1 | null>(null);
  const [quickSave, setQuickSave] = useState<QuickVoiceSaveResult | null>(null);
  const [editableTranscript, setEditableTranscript] = useState('');
  const [editingTranscript, setEditingTranscript] = useState(false);
  const [modelDownload, setModelDownload] = useState<{ bytesWritten: number; totalBytes: number | null } | null>(null);
  const [providerPrepareMs, setProviderPrepareMs] = useState<number | null>(null);
  const [flowTimings, setFlowTimings] = useState<QuickVoiceFlowTimings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const quickProvider = useRef<MobileTranscriptionProvider | null>(null);
  const clientRequestId = useRef<string | null>(null);

  useEffect(() => () => { if (mode === 'quick') void quickVoice?.releaseProvider?.(); }, [mode]);

  async function startMeetingRecording() {
    setError(null);
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error('마이크 권한이 필요합니다. Android 설정에서 업무수첩의 마이크 권한을 허용해주세요.');
      if (Platform.OS === 'android') {
        const notificationPermission = await AudioModule.requestNotificationPermissionsAsync();
        if (!notificationPermission.granted) throw new Error('백그라운드 녹음에는 알림 권한이 필요합니다. Android 설정에서 업무수첩의 알림을 허용해주세요.');
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true, allowsBackgroundRecording: true });
      await recorder.prepareToRecordAsync(); recorder.record();
      setRecordingStartedAt(new Date().toISOString()); setCompleted(null); setPhase('recording');
    } catch (nextError) { setPhase('idle'); setError(messageOf(nextError, '녹음을 시작하지 못했습니다.')); }
  }

  async function startQuickVoice() {
    if (!quickVoice || inFlight.current || quickPhase === 'recording') return;
    inFlight.current = true; setError(null); setModelDownload(null); setProviderPrepareMs(null); setFlowTimings(null); setQuickAudio(null); setQuickTranscript(null); setQuickSave(null); setEditableTranscript(''); setEditingTranscript(false); setQuickPhase('preparing');
    try {
      const providerStartedAt = Date.now();
      quickProvider.current = await quickVoice.ensureProvider((progress) => setModelDownload(progress));
      setProviderPrepareMs(Math.max(0, Date.now() - providerStartedAt));
      await quickCapture.start();
      clientRequestId.current = createQuickVoiceClientRequestId();
      setQuickPhase('recording');
    } catch (nextError) { setQuickPhase('idle'); setError(messageOf(nextError, 'Quick Voice를 시작하지 못했습니다.')); }
    finally { inFlight.current = false; }
  }

  async function persistTranscript(audio: QuickVoicePcmAudioInput, transcript?: MobileTranscriptV1) {
    if (!quickVoice || inFlight.current) return;
    const requestId = clientRequestId.current;
    if (!requestId) { setQuickPhase('save_error'); setError('Quick Voice 저장 요청 ID를 확인하지 못했습니다. 새 녹음으로 다시 시도해주세요.'); return; }
    inFlight.current = true; setError(null);
    try {
      const onProgress = (stage: 'transcribing' | 'saving' | 'refreshing') => setQuickPhase(stage);
      const result = transcript
        ? await saveQuickVoiceTranscript({ transcript, clientRequestId: requestId, recordedAt: audio.createdAt, saveWorklog: quickVoice.saveWorklog, refreshBriefing: quickVoice.refreshBriefing, onProgress })
        : await runQuickVoiceFastPath({ provider: quickProvider.current || await quickVoice.ensureProvider(), audio, clientRequestId: requestId, saveWorklog: quickVoice.saveWorklog, refreshBriefing: quickVoice.refreshBriefing, onProgress });
      setQuickTranscript(result.transcript); setQuickSave(result.saveResult); setEditableTranscript(result.transcript.text); setFlowTimings(result.timings);
      setQuickPhase(result.briefingRefreshError ? 'refresh_error' : 'saved');
      if (result.briefingRefreshError) setError(result.briefingRefreshError.message);
    } catch (nextError) {
      if (nextError instanceof QuickVoiceFlowError && nextError.stage === 'save') { setQuickTranscript(nextError.transcript); setEditableTranscript(nextError.transcript?.text || ''); setQuickPhase('save_error'); }
      else setQuickPhase('transcript_error');
      setError(messageOf(nextError, '음성 업무를 처리하지 못했습니다.'));
    } finally { inFlight.current = false; }
  }

  async function stopQuickVoice() {
    if (quickPhase !== 'recording' || inFlight.current) return;
    inFlight.current = true; setError(null); setQuickPhase('captured');
    try { const audio = await quickCapture.stop(); setQuickAudio(audio); inFlight.current = false; await persistTranscript(audio); }
    catch (nextError) { setQuickPhase('transcript_error'); setError(messageOf(nextError, '녹음된 음성을 확인하지 못했습니다.')); inFlight.current = false; }
  }

  async function retryBriefing() {
    if (!quickVoice || inFlight.current) return;
    inFlight.current = true; setQuickPhase('refreshing'); setError(null);
    try { await quickVoice.refreshBriefing(); setQuickPhase('saved'); }
    catch (nextError) { setQuickPhase('refresh_error'); setError(messageOf(nextError, '브리핑을 새로고침하지 못했습니다.')); }
    finally { inFlight.current = false; }
  }

  async function updateSavedTranscript() {
    const recordId = quickSave?.recordId?.trim(); const nextTranscript = editableTranscript.trim();
    if (!quickVoice?.updateSavedWorklog || !recordId || !nextTranscript || inFlight.current) return;
    inFlight.current = true; setError(null);
    try { await quickVoice.updateSavedWorklog(recordId, nextTranscript); if (quickTranscript) setQuickTranscript({ ...quickTranscript, text: nextTranscript }); setEditingTranscript(false); await quickVoice.refreshBriefing(); setQuickPhase('saved'); }
    catch (nextError) { setError(messageOf(nextError, '수정한 업무를 반영하지 못했습니다.')); }
    finally { inFlight.current = false; }
  }

  async function stopMeetingRecording() {
    if (phase === 'idle' || phase === 'stopping') return;
    setError(null); setPhase('stopping');
    try {
      await recorder.stop(); const status = await recorder.getStatus(); const uri = recorder.uri || status.url;
      if (!uri) throw new Error('녹음은 종료됐지만 로컬 파일 경로를 확인하지 못했습니다.');
      const recording = createMobileRecordingAudioInput({ uri, durationMs: status.durationMillis || recorderState.durationMillis, createdAt: recordingStartedAt || undefined });
      rememberMeetingRecording(recording);
      setCompleted(recording);
      setMeetingLibraryVersion((value) => value + 1);
      setRecordingStartedAt(null); setPhase('idle'); await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false });
    } catch (nextError) { setPhase('idle'); setError(messageOf(nextError, '녹음을 종료하지 못했습니다.')); }
  }

  const meetingActive = phase === 'recording' || phase === 'paused' || phase === 'stopping';
  const quickActive = ['recording', 'preparing', 'captured', 'transcribing', 'saving', 'refreshing'].includes(quickPhase);

  if (mode === 'quick') {
    const canStart = !quickActive;
    const isRecording = quickPhase === 'recording';
    const statusDone = quickPhase === 'saved' || quickPhase === 'refresh_error';
    return <View style={styles.quickDock}>
      <View style={styles.quickStatusBubble}><Text style={styles.quickStatusBubbleText}>{quickStatus(quickPhase)}</Text></View>
      {quickPhase === 'preparing' && modelDownload ? <Text style={styles.quickProgress}>음성 모델 받는 중 · {formatBytes(modelDownload.bytesWritten)}{modelDownload.totalBytes ? ` / ${formatBytes(modelDownload.totalBytes)}` : ''}</Text> : null}

      <View style={styles.quickControls}>
        <Pressable accessibilityRole="button" accessibilityLabel="업무 직접 입력 열기" disabled={!onOpenWorklogInput || quickActive} style={[styles.quickSideAction, quickActive ? styles.quickSideActionDisabled : null]} onPress={onOpenWorklogInput}>
          <Text style={styles.quickSideIcon}>✏️</Text>
          <Text style={styles.quickSideLabel}>메모</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isRecording ? '음성 기록 종료 후 업무 저장' : '음성 기록 시작'}
          disabled={quickActive && !isRecording}
          style={[styles.quickMic, isRecording ? styles.quickMicActive : null, quickActive && !isRecording ? styles.quickMicBusy : null]}
          onPress={() => void (isRecording ? stopQuickVoice() : canStart ? startQuickVoice() : undefined)}
        >
          <Text style={styles.quickMicIcon}>{isRecording ? '■' : '🎙'}</Text>
          <Text style={styles.quickMicLabel}>{isRecording ? '종료·저장' : quickActive ? '처리 중' : '음성 기록'}</Text>
        </Pressable>

        <View style={styles.quickSideStatus}>
          <Text style={styles.quickStatusIcon}>{statusDone ? '✓' : quickPhase === 'transcript_error' || quickPhase === 'save_error' ? '!' : '●'}</Text>
          <Text style={styles.quickSideLabel}>{statusDone ? '저장됨' : isRecording ? '녹음 중' : quickPhase === 'idle' ? '대기' : '처리 중'}</Text>
        </View>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {quickPhase === 'transcript_error' && quickAudio ? <View style={styles.quickResult}><Text style={styles.quickResultTitle}>음성은 보존했습니다.</Text><Text style={styles.meta}>입력 신호 · Peak {quickAudio.signal.peak.toFixed(3)} · RMS {quickAudio.signal.rms.toFixed(3)} · 유효 샘플 {(quickAudio.signal.nonZeroRatio * 100).toFixed(1)}%</Text><Button title="다시 전사" onPress={() => void persistTranscript(quickAudio)} />{onOpenWorklogInput ? <Button title="업무 직접 입력" onPress={onOpenWorklogInput} /> : null}</View> : null}
      {quickPhase === 'save_error' && quickAudio && quickTranscript ? <View style={styles.quickResult}><Text style={styles.quickResultTitle}>전사문을 보존했습니다.</Text><Text style={styles.transcript}>{quickTranscript.text}</Text><Button title="같은 업무 다시 저장" onPress={() => void persistTranscript(quickAudio, quickTranscript)} />{onOpenWorklogInput ? <Button title="업무 직접 입력" onPress={onOpenWorklogInput} /> : null}</View> : null}
      {quickPhase === 'refresh_error' ? <View style={styles.quickResult}><Text style={styles.quickResultTitle}>✅ 저장 완료 · 브리핑 갱신 실패</Text><Button title="브리핑만 다시 불러오기" onPress={() => void retryBriefing()} /></View> : null}
      {quickTranscript && (quickPhase === 'saved' || quickPhase === 'refresh_error') ? <View style={styles.quickResult}>
        <Text style={styles.quickResultTitle}>✅ 업무 저장 완료</Text>
        {quickAudio ? <Text style={styles.meta}>PCM {quickAudio.sampleRate}Hz · {quickAudio.channels}ch · 녹음 {formatDuration(quickAudio.durationMs)} · Peak {quickAudio.signal.peak.toFixed(3)} · RMS {quickAudio.signal.rms.toFixed(3)} · 모델 {formatMs(providerPrepareMs)} · 전사 {formatMs(flowTimings?.transcribeMs ?? null)} · 저장 {formatMs(flowTimings?.saveMs ?? null)} · 브리핑 {formatMs(flowTimings?.briefingRefreshMs ?? null)}</Text> : null}
        {editingTranscript ? <><TextInput accessibilityLabel="전사문 수정" multiline style={styles.transcriptInput} value={editableTranscript} onChangeText={setEditableTranscript} textAlignVertical="top" /><Button title="수정 반영" disabled={!quickSave?.recordId || !editableTranscript.trim()} onPress={() => void updateSavedTranscript()} /><Button title="수정 취소" onPress={() => { setEditableTranscript(quickTranscript.text); setEditingTranscript(false); }} /></> : <><Text style={styles.transcript}>{quickTranscript.text}</Text>{quickVoice?.updateSavedWorklog && quickSave?.recordId ? <Button title="✏️ 전사문 수정" onPress={() => setEditingTranscript(true)} /> : null}</>}
      </View> : null}
      {!quickActive && !quickTranscript && !error ? <Text style={styles.quickHint}>가운데 마이크를 누르면 바로 녹음하고 업무로 저장합니다.</Text> : null}
    </View>;
  }

  return <View style={styles.card}>
    <Text style={styles.sectionTitle}>회의 녹음</Text>
    <Text style={styles.body}>긴 회의도 로컬에 보존합니다. 화면을 잠그거나 다른 앱으로 이동해도 녹음이 계속됩니다.</Text>
    <View style={styles.statusRow}><Text style={styles.timer}>{formatDuration(recorderState.durationMillis)}</Text><Text style={styles.status}>{phase === 'recording' ? '녹음 중' : phase === 'paused' ? '일시정지' : phase === 'stopping' ? '저장 중' : '대기'}</Text></View>
    {!meetingActive ? <Button title="녹음 시작" onPress={() => void startMeetingRecording()} /> : null}
    {phase === 'recording' ? <Button title="일시정지" onPress={() => { recorder.pause(); setPhase('paused'); }} /> : null}
    {phase === 'paused' ? <Button title="녹음 재개" onPress={() => { recorder.record(); setPhase('recording'); }} /> : null}
    {meetingActive ? <Button title={phase === 'stopping' ? '저장 중...' : '녹음 종료'} disabled={phase === 'stopping'} onPress={() => void stopMeetingRecording()} /> : null}
    {meetingActive ? <Text style={styles.notice}>Android에서는 녹음 중 시스템의 지속 알림이 표시됩니다.</Text> : null}
    {error ? <Text style={styles.errorText}>{error}</Text> : null}
    {completed ? <View style={styles.result}><Text style={styles.resultTitle}>✅ 회의 녹음 파일 저장 완료</Text><Text style={styles.meta}>파일: {completed.fileName}</Text><Text style={styles.meta}>길이: {formatDuration(completed.durationMs)}</Text><Text style={styles.meta}>형식: {completed.mimeType}</Text><Text style={styles.notice}>회의 녹음 파일은 기기에 보존됐습니다. 아래 목록에서 바로 재생할 수 있습니다.</Text></View> : null}
    <MeetingRecordingLibrary refreshToken={meetingLibraryVersion} />
  </View>;
}

const styles = StyleSheet.create({
  quickDock: { backgroundColor: 'transparent', borderTopWidth: 0, paddingHorizontal: 18, paddingTop: mobileTheme.spacing.compact, paddingBottom: mobileTheme.spacing.compact, gap: 7 },
  quickStatusBubble: { alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(241,245,249,0.92)' },
  quickStatusBubbleText: { fontSize: 11, fontWeight: '800', color: '#475569' },
  quickProgress: { textAlign: 'center', fontSize: 11, color: '#475569' },
  quickControls: { minHeight: 82, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 22 },
  quickMic: { width: 96, height: 96, marginTop: -20, borderRadius: 48, alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: mobileTheme.colors.primary, borderWidth: 5, borderColor: mobileTheme.colors.surface, shadowColor: mobileTheme.colors.primary, shadowOpacity: 0.24, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  quickMicActive: { backgroundColor: mobileTheme.colors.danger },
  quickMicBusy: { opacity: 0.65 },
  quickMicIcon: { fontSize: 26, color: '#fff' },
  quickMicLabel: { fontSize: 12, fontWeight: '900', color: '#fff' },
  quickSideAction: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', gap: 2, borderWidth: 1, borderColor: mobileTheme.colors.border, backgroundColor: 'rgba(255,255,255,0.92)' },
  quickSideActionDisabled: { opacity: 0.4 },
  quickSideStatus: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', gap: 2, borderWidth: 1, borderColor: mobileTheme.colors.border, backgroundColor: 'rgba(248,250,252,0.92)' },
  quickSideIcon: { fontSize: 18 },
  quickStatusIcon: { fontSize: 16, fontWeight: '900', color: '#245c2a' },
  quickSideLabel: { fontSize: 10, fontWeight: '800', color: '#374151' },
  quickHint: { textAlign: 'center', fontSize: 11, color: '#737985', lineHeight: 16 },
  quickResult: { gap: 6, paddingHorizontal: 4, paddingBottom: 2 },
  quickResultTitle: { textAlign: 'center', fontSize: 12, fontWeight: '800', color: mobileTheme.colors.success },
  card: { backgroundColor: mobileTheme.colors.surface, borderRadius: mobileTheme.radius.card, padding: mobileTheme.spacing.card, gap: 14 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: mobileTheme.colors.text },
  body: { fontSize: 14, color: mobileTheme.colors.textSecondary, lineHeight: 20 },
  statusRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  timer: { fontSize: 30, fontWeight: '800', color: '#17191d', fontVariant: ['tabular-nums'] },
  status: { fontSize: 14, fontWeight: '700', color: '#4b515c' },
  notice: { fontSize: 12, color: '#737985', lineHeight: 18 },
  errorText: { color: mobileTheme.colors.danger, lineHeight: 20, fontSize: 12 },
  result: { borderWidth: 1, borderColor: '#e0e3e8', borderRadius: 12, padding: 14, gap: 8 },
  resultTitle: { fontSize: 15, fontWeight: '700', color: '#17191d' },
  meta: { fontSize: 11, color: '#737985', lineHeight: 16 },
  transcript: { fontSize: 14, color: '#30343b', lineHeight: 20 },
  transcriptInput: { minHeight: 90, borderWidth: 1, borderColor: '#cfd5dd', borderRadius: 10, padding: 10, fontSize: 14, color: '#30343b' },
});
