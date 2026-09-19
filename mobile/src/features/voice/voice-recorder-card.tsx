import { useRef, useState } from 'react';
import { Alert, Button, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { type QuickVoicePcmAudioInput } from '@/src/features/voice/audio-input';
import { createQuickVoiceClientRequestId, createQuickVoiceSaveAttempt, quickVoiceNeedsAttention, QuickVoiceFlowError, transcribeQuickVoiceCapture, type QuickVoiceFlowTimings } from '@/src/features/voice/quick-voice-flow';
import { MeetingRecordingLibrary } from '@/src/features/voice/meeting-recording-library';
import { useMeetingRecordingSession } from '@/src/features/voice/meeting-recording-provider';
import { useQuickVoicePcmCapture } from '@/src/features/voice/quick-voice-pcm';
import type { MobileTranscriptV1, MobileTranscriptionProvider } from '@/src/features/voice/transcription-provider';
import { mobileTheme } from '@/src/ui/theme';

type QuickVoicePhase = 'idle' | 'preparing' | 'recording' | 'captured' | 'transcribing' | 'review' | 'saving' | 'refreshing' | 'saved' | 'transcript_error' | 'save_error' | 'refresh_error';
type QuickVoiceSaveResult = Readonly<{ recordId?: string; scheduleDetected?: boolean; scheduleCreated?: boolean; scheduleId?: string; dueStart?: string }>;
type QuickVoiceProps = Readonly<{
  ensureProvider(onProgress?: (progress: { bytesWritten: number; totalBytes: number | null }) => void): Promise<MobileTranscriptionProvider>;
  saveWorklog(transcript: string, options: { clientRequestId: string; recordedAt: string }): Promise<QuickVoiceSaveResult>;
  refreshBriefing(): Promise<unknown>;
}>;
type VoiceRecorderCardProps = { mode?: 'quick' | 'meeting'; onOpenWorklogInput?: () => void; quickVoice?: QuickVoiceProps; navigationGuard?: { current: boolean } };

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
}
function messageOf(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }
function formatBytes(bytes: number) { return `${(Math.max(0, bytes) / (1024 * 1024)).toFixed(1)}MB`; }
function formatMs(ms: number | null) { return ms === null ? '-' : `${(Math.max(0, ms) / 1000).toFixed(2)}초`; }
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
  return ({ idle: '대기', preparing: '음성 모델 준비 중', recording: '녹음 중', captured: '녹음 확인 중', transcribing: '한국어 전사 중', review: '전사문 확인 필요', saving: '업무 저장 중', refreshing: '브리핑 새로고침 중', saved: '업무 저장 완료', transcript_error: '전사 재시도 필요', save_error: '저장 재시도 필요', refresh_error: '브리핑 새로고침 재시도 필요' } satisfies Record<QuickVoicePhase, string>)[phase];
}

export function VoiceRecorderCard({ mode = 'quick', onOpenWorklogInput, quickVoice, navigationGuard }: VoiceRecorderCardProps) {
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
  const inFlight = useRef(false);
  const quickProvider = useRef<MobileTranscriptionProvider | null>(null);
  const clientRequestId = useRef<string | null>(null);
  // createQuickVoiceSaveAttempt retains the saveQuickVoiceTranscript payload across retries.
  const saveAttempt = useRef<ReturnType<typeof createQuickVoiceSaveAttempt<QuickVoiceSaveResult>> | null>(null);
  function setQuickPhase(phase: QuickVoicePhase) {
    // Update the parent guard synchronously, before awaiting capture or network.
    if (navigationGuard) navigationGuard.current = quickVoiceNeedsAttention(phase);
    applyQuickPhase(phase);
  }


  async function startQuickVoice() {
    if (!quickVoice || inFlight.current || quickPhase === 'recording') return;
    saveAttempt.current = null;
    inFlight.current = true; setError(null); setModelDownload(null); setProviderPrepareMs(null); setFlowTimings(null); setQuickAudio(null); setQuickTranscript(null); setQuickSave(null); setEditableTranscript(''); setQuickPhase('preparing');
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

  async function confirmTranscriptSave(audio: QuickVoicePcmAudioInput, transcript: MobileTranscriptV1) {
    if (!quickVoice || inFlight.current || !editableTranscript.trim()) return;
    const requestId = clientRequestId.current;
    if (!requestId) { setQuickPhase('save_error'); setError('Quick Voice 저장 요청 ID를 확인하지 못했습니다. 새 녹음으로 다시 시도해주세요.'); return; }
    inFlight.current = true; setError(null);
    try {
      const onProgress = (stage: 'transcribing' | 'saving' | 'refreshing') => {
        if (stage !== 'transcribing') setQuickPhase(stage);
      };
      const confirmedTranscript = { ...transcript, text: editableTranscript.trim() };
      if (!saveAttempt.current) saveAttempt.current = createQuickVoiceSaveAttempt({ transcript: confirmedTranscript, clientRequestId: requestId, recordedAt: audio.createdAt, saveWorklog: quickVoice.saveWorklog, refreshBriefing: quickVoice.refreshBriefing, onProgress, transcribeMs: flowTimings?.transcribeMs ?? null });
      setEditableTranscript(saveAttempt.current.text);
      const result = await saveAttempt.current.save();
      setQuickTranscript(result.transcript); setQuickSave(result.saveResult); setEditableTranscript(result.transcript.text); setFlowTimings(result.timings);
      setQuickPhase(result.briefingRefreshError ? 'refresh_error' : 'saved');
      if (result.briefingRefreshError) setError(result.briefingRefreshError.message);
    } catch (nextError) {
      if (nextError instanceof QuickVoiceFlowError && nextError.stage === 'save') { setQuickTranscript(nextError.transcript); setEditableTranscript(nextError.transcript?.text || editableTranscript); setQuickPhase('save_error'); }
      else setQuickPhase('transcript_error');
      setError(messageOf(nextError, '음성 업무를 처리하지 못했습니다.'));
    } finally { inFlight.current = false; }
  }

  async function stopQuickVoice() {
    if (quickPhase !== 'recording' || inFlight.current) return;
    inFlight.current = true; setError(null); setQuickPhase('captured');
    try { const audio = await quickCapture.stop(); setQuickAudio(audio); inFlight.current = false; await transcribeCapturedAudio(audio); }
    catch (nextError) { setQuickPhase('transcript_error'); setError(messageOf(nextError, '녹음된 음성을 확인하지 못했습니다.')); inFlight.current = false; }
  }

  async function transcribeCapturedAudio(audio: QuickVoicePcmAudioInput) {
    if (!quickVoice || inFlight.current) return;
    inFlight.current = true; setError(null); setQuickPhase('transcribing');
    try {
      const result = await transcribeQuickVoiceCapture({ provider: quickProvider.current || await quickVoice.ensureProvider(), audio });
      setQuickTranscript(result.transcript); setEditableTranscript(result.transcript.text);
      setFlowTimings({ transcribeMs: result.transcribeMs, saveMs: 0, briefingRefreshMs: 0 });
      setQuickPhase('review');
    } catch (nextError) { setQuickPhase('transcript_error'); setError(messageOf(nextError, '음성 전사를 처리하지 못했습니다.')); }
    finally { inFlight.current = false; }
  }

  function discardQuickVoice() {
    if (inFlight.current) return;
    const clear = () => {
      clientRequestId.current = null; saveAttempt.current = null;
      setError(null); setQuickAudio(null); setQuickTranscript(null); setQuickSave(null); setEditableTranscript(''); setFlowTimings(null); setQuickPhase('idle');
    };
    if (quickPhase === 'save_error') {
      Alert.alert('저장 결과 확인 필요', '서버에 이미 저장됐을 수 있습니다. 같은 업무 다시 저장으로 먼저 확인할 수 있습니다. 전사문을 버려도 서버 기록을 취소하지는 않습니다.', [
        { text: '돌아가기', style: 'cancel' }, { text: '전사문만 버리기', style: 'destructive', onPress: clear },
      ]);
    } else clear();
  }

  async function retryBriefing() {
    if (!quickVoice || inFlight.current) return;
    inFlight.current = true; setQuickPhase('refreshing'); setError(null);
    try { await quickVoice.refreshBriefing(); setQuickPhase('saved'); }
    catch (nextError) { setQuickPhase('refresh_error'); setError(messageOf(nextError, '브리핑을 새로고침하지 못했습니다.')); }
    finally { inFlight.current = false; }
  }

  const meetingActive = meeting.active;
  const quickActive = ['recording', 'preparing', 'captured', 'transcribing', 'review', 'saving', 'refreshing', 'save_error', 'transcript_error'].includes(quickPhase);

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
          accessibilityLabel={isRecording ? '음성 기록 종료 후 전사문 확인' : '음성 기록 시작'}
          disabled={quickActive && !isRecording}
          style={[styles.quickMic, isRecording ? styles.quickMicActive : null, quickActive && !isRecording ? styles.quickMicBusy : null]}
          onPress={() => void (isRecording ? stopQuickVoice() : canStart ? startQuickVoice() : undefined)}
        >
          <Text style={styles.quickMicIcon}>{isRecording ? '■' : '🎙'}</Text>
          <Text style={styles.quickMicLabel}>{isRecording ? '종료·확인' : quickActive ? '처리 중' : '음성 기록'}</Text>
        </Pressable>

        <View style={styles.quickSideStatus}>
          <Text style={styles.quickStatusIcon}>{statusDone ? '✓' : quickPhase === 'transcript_error' || quickPhase === 'save_error' ? '!' : '●'}</Text>
          <Text style={styles.quickSideLabel}>{statusDone ? '저장됨' : isRecording ? '녹음 중' : quickPhase === 'idle' ? '대기' : '처리 중'}</Text>
        </View>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {quickPhase === 'transcript_error' && quickAudio ? <View style={styles.quickResult}><Text style={styles.quickResultTitle}>음성은 보존했습니다.</Text><Text style={styles.meta}>입력 신호 · Peak {quickAudio.signal.peak.toFixed(3)} · RMS {quickAudio.signal.rms.toFixed(3)} · 유효 샘플 {(quickAudio.signal.nonZeroRatio * 100).toFixed(1)}%</Text><Button title="다시 전사" onPress={() => void transcribeCapturedAudio(quickAudio)} />{onOpenWorklogInput ? <Button title="업무 직접 입력" onPress={onOpenWorklogInput} /> : null}</View> : null}
      {quickPhase === 'transcript_error' ? <Button title="녹음 버리기" onPress={discardQuickVoice} /> : null}
      {quickPhase === 'review' && quickAudio && quickTranscript ? <View style={styles.quickResult}><Text style={styles.quickResultTitle}>전사문을 확인한 뒤 저장하세요.</Text><Text style={styles.meta}>저장 전에는 업무 기록이나 일정이 생성되지 않습니다.</Text><TextInput accessibilityLabel="전사문 확인 및 수정" multiline style={styles.transcriptInput} value={editableTranscript} onChangeText={setEditableTranscript} textAlignVertical="top" /><Button title="저장" disabled={!editableTranscript.trim()} onPress={() => void confirmTranscriptSave(quickAudio, quickTranscript)} /><Button title="다시 녹음" onPress={() => { discardQuickVoice(); void startQuickVoice(); }} /><Button title="버리기" onPress={discardQuickVoice} /></View> : null}
      {quickPhase === 'save_error' && quickAudio && quickTranscript ? <View style={styles.quickResult}><Text style={styles.quickResultTitle}>전사문을 보존했습니다.</Text><TextInput accessibilityLabel="전사문 확인 및 수정" multiline editable={false} style={styles.transcriptInput} value={editableTranscript} onChangeText={setEditableTranscript} textAlignVertical="top" /><Button title="같은 업무 다시 저장" disabled={!editableTranscript.trim()} onPress={() => void confirmTranscriptSave(quickAudio, quickTranscript)} /><Button title="버리기" onPress={discardQuickVoice} />{onOpenWorklogInput ? <Button title="업무 직접 입력" onPress={onOpenWorklogInput} /> : null}</View> : null}
      {quickPhase === 'refresh_error' ? <View style={styles.quickResult}><Text style={styles.quickResultTitle}>✅ 저장 완료 · 브리핑 갱신 실패</Text><Button title="브리핑만 다시 불러오기" onPress={() => void retryBriefing()} /></View> : null}
      {quickTranscript && (quickPhase === 'saved' || quickPhase === 'refresh_error') ? <View style={styles.quickResult}>
        <Text style={styles.quickResultTitle}>✅ 업무 저장 완료</Text>
        {quickAudio ? <Text style={styles.meta}>PCM {quickAudio.sampleRate}Hz · {quickAudio.channels}ch · 녹음 {formatDuration(quickAudio.durationMs)} · Peak {quickAudio.signal.peak.toFixed(3)} · RMS {quickAudio.signal.rms.toFixed(3)} · 모델 {formatMs(providerPrepareMs)} · 전사 {formatMs(flowTimings?.transcribeMs ?? null)} · 저장 {formatMs(flowTimings?.saveMs ?? null)} · 브리핑 {formatMs(flowTimings?.briefingRefreshMs ?? null)}</Text> : null}
        {quickSave?.scheduleCreated ? <Text style={styles.scheduleSuccess}>📅 일정 생성 완료{formatSavedDue(quickSave.dueStart) ? ` · ${formatSavedDue(quickSave.dueStart)}` : ''}</Text> : <Text style={styles.scheduleNeutral}>일정으로 해석된 날짜·시간은 없습니다.</Text>}
        <Text style={styles.transcript}>{quickTranscript.text}</Text>
      </View> : null}
      {!quickActive && !quickTranscript && !error ? <Text style={styles.quickHint}>가운데 마이크를 누르면 녹음·전사 후 내용을 확인하고 저장합니다.</Text> : null}
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
  scheduleSuccess: { fontSize: 13, fontWeight: '800', color: mobileTheme.colors.link, lineHeight: 19, textAlign: 'center' },
  scheduleNeutral: { fontSize: 12, color: mobileTheme.colors.textMuted, lineHeight: 18, textAlign: 'center' },
  transcript: { fontSize: 14, color: '#30343b', lineHeight: 20 },
  transcriptInput: { minHeight: 90, maxHeight: 150, borderWidth: 1, borderColor: '#cfd5dd', borderRadius: 10, padding: 10, fontSize: 14, color: '#30343b' },
});
