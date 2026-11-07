import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, Modal, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  deleteMeetingRecording,
  listMeetingRecordings,
  isMeetingRecordingFileAvailable,
  searchMeetingRecordings,
  renameMeetingRecording,
  type MeetingRecordingEntry,
} from './meeting-recordings';
import { mobileTheme } from '@/src/ui/theme';
import { formatMeetingMinutesForShare, type MeetingMinutesDocumentV1 } from './meeting-minutes-document';
import { hasMeetingMinutes, loadMeetingMinutes, saveMeetingMinutes } from './meeting-minutes-storage';
import type { MeetingTranscriptCheckpointV1 } from './meeting-transcript-checkpoint';
import {
  MEETING_TRANSCRIPTION_QA_ONLY,
  canStartMeetingTranscription,
  readSavedMeetingTranscript,
  transcribeMeetingForQa,
} from './meeting-transcription-ui';

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function formatRecordedAt(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatRecordingMonth(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: 'long',
  }).format(new Date(value));
}

function formatBytes(bytes: number | null) {
  if (bytes === null) return '용량 확인 중';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

function MeetingRecordingPlayer({ recording }: { recording: MeetingRecordingEntry }) {
  const player = useAudioPlayer(recording.uri, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const durationSeconds = status.duration || Math.max(0, recording.durationMs / 1000);
  const currentSeconds = Math.min(status.currentTime || 0, durationSeconds || Number.MAX_SAFE_INTEGER);

  async function togglePlayback() {
    if (status.playing) {
      player.pause();
      return;
    }

    await setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: false,
      allowsBackgroundRecording: false,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    });

    if (status.didJustFinish && durationSeconds > 0) {
      await player.seekTo(0);
    }
    player.play();
  }

  function seekBy(deltaSeconds: number) {
    const next = Math.max(0, Math.min(durationSeconds || Number.MAX_SAFE_INTEGER, currentSeconds + deltaSeconds));
    void player.seekTo(next);
  }

  return <View style={styles.player}>
    <View style={styles.playerProgressRow}>
      <Text style={styles.playerTime}>{formatDuration(currentSeconds * 1000)}</Text>
      <Text style={styles.playerTime}>{formatDuration(durationSeconds * 1000)}</Text>
    </View>
    <View style={styles.playerActions}>
      <Pressable accessibilityRole="button" style={styles.smallAction} onPress={() => seekBy(-15)}>
        <Text style={styles.smallActionText}>↶ 15초</Text>
      </Pressable>
      <Pressable accessibilityRole="button" style={styles.playAction} onPress={() => { void togglePlayback(); }}>
        <Text style={styles.playActionText}>{status.playing ? '⏸ 일시정지' : status.didJustFinish ? '↻ 다시 듣기' : '▶ 재생'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" style={styles.smallAction} onPress={() => seekBy(15)}>
        <Text style={styles.smallActionText}>15초 ↷</Text>
      </Pressable>
    </View>
    {status.error ? <Text style={styles.errorText}>재생 오류: {status.error}</Text> : null}
  </View>;
}

function MeetingMinutesEditor({ recording, onClose }: {
  recording: MeetingRecordingEntry;
  onClose(): void;
}) {
  const [transcriptText, setTranscriptText] = useState('');
  const [minutesText, setMinutesText] = useState('');
  const [saved, setSaved] = useState<MeetingMinutesDocumentV1 | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [rawTranscript, setRawTranscript] = useState<MeetingTranscriptCheckpointV1 | null>(null);
  const [transcriptionError, setTranscriptionError] = useState('');
  const [checkpointDamaged, setCheckpointDamaged] = useState(false);
  const [transcriptionBusy, setTranscriptionBusy] = useState(false);
  const [transcriptionStatus, setTranscriptionStatus] = useState('');
  const transcriptionInFlight = useRef(false);
  const editorMounted = useRef(true);
  const hasNativeTranscription = useMemo(() => canStartMeetingTranscription(), []);
  const scrollRef = useRef<ScrollView>(null);
  const focusedInput = useRef<'transcript' | 'minutes' | null>(null);
  const inputPositions = useRef({ transcript: 0, minutes: 0 });

  useEffect(() => {
    editorMounted.current = true;
    return () => { editorMounted.current = false; };
  }, []);

  // A Modal owns a separate native window: scroll again after the keyboard appears.
  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidShow', () => {
      const field = focusedInput.current;
      if (field) scrollRef.current?.scrollTo({
        y: Math.max(0, inputPositions.current[field] - 16), animated: true,
      });
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    setLoaded(false);
    setLoadFailed(false);
    try {
      const document = loadMeetingMinutes(recording.id);
      setSaved(document);
      setTranscriptText(document?.transcriptText ?? '');
      setMinutesText(document?.minutesText ?? '');
      setLoaded(true);
    } catch (nextError) {
      setLoadFailed(true);
      setError(nextError instanceof Error ? nextError.message : '회의록을 읽지 못했습니다.');
    }
  }, [recording.id]);

  useEffect(() => {
    setRawTranscript(null);
    setTranscriptionError('');
    setCheckpointDamaged(false);
    try {
      // A damaged raw-transcript checkpoint is not a blank record. Never
      // auto-overwrite or rerun STT while it cannot be read safely.
      setRawTranscript(readSavedMeetingTranscript(recording));
    } catch (nextError) {
      setCheckpointDamaged(true);
      setTranscriptionError(nextError instanceof Error
        ? nextError.message : '저장된 전사문을 확인할 수 없습니다.');
    }
  }, [recording.id]);

  const dirty = transcriptText !== (saved?.transcriptText ?? '') ||
    minutesText !== (saved?.minutesText ?? '');

  function requestClose() {
    if (transcriptionInFlight.current) {
      Alert.alert('회의 자동 전사 진행 중', '기기에서 전사 중입니다. 완료된 뒤 닫아주세요.');
      return;
    }
    if (!dirty) { onClose(); return; }
    Alert.alert('저장하지 않은 변경', '작성 중인 내용이 저장되지 않았습니다.', [
      { text: '돌아가기', style: 'cancel' },
      { text: '변경 버리기', style: 'destructive', onPress: onClose },
    ]);
  }

  function saveDraft() {
    if (!loaded || loadFailed) return;
    setError('');
    setNotice('');
    try {
      const document = saveMeetingMinutes({ recordingId: recording.id, transcriptText, minutesText, expectedPrevious: saved });
      setSaved(document);
      setTranscriptText(document.transcriptText);
      setMinutesText(document.minutesText);
      setNotice('회의록을 이 기기에 저장했습니다.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '회의록을 저장하지 못했습니다.');
    }
  }

  async function shareSavedDraft() {
    if (!saved || dirty || !loaded || loadFailed) {
      setError('내용을 먼저 저장한 뒤 공유해주세요.');
      return;
    }
    setError('');
    try {
      const latest = loadMeetingMinutes(recording.id);
      if (!latest || latest.updatedAt !== saved.updatedAt ||
          latest.transcriptText !== saved.transcriptText ||
          latest.minutesText !== saved.minutesText) {
        throw new Error('최신 회의록과 변경 내용이 다릅니다. 다시 열어 확인해주세요.');
      }
      await Share.share({
        title: '업무수첩 회의록',
        message: formatMeetingMinutesForShare({
          document: saved,
          title: recording.title || '회의 녹음',
          recordedAt: recording.createdAt,
        }),
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '공유 화면을 열지 못했습니다.');
    }
  }

  async function startQaTranscription() {
    if (transcriptionInFlight.current || !hasNativeTranscription ||
        !loaded || loadFailed || checkpointDamaged || rawTranscript ||
        !isMeetingRecordingFileAvailable(recording)) return;
    Keyboard.dismiss();
    transcriptionInFlight.current = true;
    setTranscriptionBusy(true);
    setTranscriptionError('');
    setTranscriptionStatus('음성 모델 준비·전사 진행 중입니다. 기기에 저장된 원본은 유지됩니다.');
    try {
      const result = await transcribeMeetingForQa({
        recording,
        onModelDownload(writtenBytes, totalBytes) {
          if (!editorMounted.current) return;
          const percent = totalBytes && totalBytes > 0
            ? Math.min(100, Math.floor(100 * writtenBytes / totalBytes))
            : null;
          setTranscriptionStatus(percent === null
            ? '기존 Whisper 모델을 준비하고 있습니다.'
            : 'Whisper 모델 준비 ' + percent + '% · 완료되면 기기 내에서 전사합니다.');
        },
      });
      if (!editorMounted.current) return;
      setRawTranscript(result.checkpoint);
      setTranscriptionStatus('');
      setNotice(result.reused
        ? '기기에 보관된 전사문을 불러왔습니다.'
        : '자동 전사문이 이 기기에 저장됐습니다. 내용을 확인한 뒤 가져오세요.');
    } catch (nextError) {
      if (editorMounted.current) {
        setTranscriptionError(nextError instanceof Error
          ? nextError.message : '자동 전사에 실패했습니다. 녹음 원본은 보존됩니다.');
      }
    } finally {
      transcriptionInFlight.current = false;
      if (editorMounted.current) setTranscriptionBusy(false);
    }
  }

  function importRawTranscript() {
    const text = rawTranscript?.transcript.text ?? '';
    if (!text || !loaded || loadFailed || transcriptionBusy) return;
    if (text.length > 120000) {
      setTranscriptionError('녹취문 입력 한도를 초과합니다. 원문을 자르거나 덮어쓰지 않았습니다.');
      return;
    }
    const apply = () => {
      setTranscriptText(text);
      setNotice('자동 전사문을 편집칸에 가져왔습니다. 검토 후 저장을 눌러주세요.');
      setError('');
      focusedInput.current = 'transcript';
      scrollRef.current?.scrollTo({ y: Math.max(0, inputPositions.current.transcript - 16), animated: true });
    };
    if (transcriptText.trim() && transcriptText !== text) {
      Alert.alert('기존 녹취문 입력', '현재 입력 중인 녹취문이 있습니다. 교체해도 이전 저장본은 저장을 누르기 전까지 변경되지 않습니다.', [
        { text: '취소', style: 'cancel' },
        { text: '입력칸에 가져오기', onPress: apply },
      ]);
    } else {
      apply();
    }
  }

  return <Modal visible animationType="slide" onRequestClose={requestClose}>
    <KeyboardAvoidingView style={styles.minutesKeyboard} behavior="padding">
      <SafeAreaView style={styles.minutesModal}>
      <View style={styles.minutesHeader}>
        <Text style={styles.minutesHeading}>회의록</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="회의록 닫기" onPress={requestClose} style={styles.minutesClose}><Text style={styles.renameActionText}>닫기</Text></Pressable>
      </View>
      <ScrollView
        ref={scrollRef}
        style={styles.minutesScroll}
        contentContainerStyle={styles.minutesContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={styles.recordingTitle}>{recording.title || `회의 녹음 · ${formatRecordedAt(recording.createdAt)}`}</Text>
        <Text style={styles.recordingMeta}>{formatDuration(recording.durationMs)} · 이 기기에 저장된 녹음</Text>
        <MeetingRecordingPlayer recording={recording} />
        {MEETING_TRANSCRIPTION_QA_ONLY ? <View style={styles.transcriptionQaPanel}>
          <Text style={styles.minutesLabel}>자동 전사 실험 · QA 전용</Text>
          <Text style={styles.minutesHelp}>
            Whisper 모델이 기기에 없으면 최초 약 148MB 다운로드가 필요할 수 있습니다. 음성은 서버로 전송하지 않습니다.
          </Text>
          {rawTranscript
            ? <>
              <Text style={styles.recordingMeta}>원시 전사문 저장됨 · {rawTranscript.transcript.text.length}자 · 회의록과 별도 보관</Text>
              <Text style={styles.transcriptPreview} selectable>
                {rawTranscript.transcript.text.slice(0, 1200)}
                {rawTranscript.transcript.text.length > 1200 ? ' … (이하 생략, 원문은 기기 저장소에 보존)' : ''}
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel="전사문 녹취문으로 가져오기"
                disabled={!loaded || loadFailed || transcriptionBusy}
                style={[styles.renameSecondary, !loaded || loadFailed || transcriptionBusy ? styles.minutesDisabled : null]}
                onPress={importRawTranscript}>
                <Text style={styles.renameSecondaryText}>녹취문 입력칸으로 가져오기</Text>
              </Pressable>
            </>
            : hasNativeTranscription && !checkpointDamaged && isMeetingRecordingFileAvailable(recording)
              ? <Pressable accessibilityRole="button" accessibilityLabel="회의 자동 전사 시작 QA"
                disabled={!loaded || loadFailed || transcriptionBusy}
                style={[styles.renamePrimary, !loaded || loadFailed || transcriptionBusy ? styles.minutesDisabled : null]}
                onPress={() => void startQaTranscription()}>
                <Text style={styles.renamePrimaryText}>{transcriptionBusy ? '전사 준비·진행 중' : '자동 전사 시작 · QA'}</Text>
              </Pressable>
              : <Text style={styles.recordingMeta}>
                {hasNativeTranscription ? '원본 녹음이 없거나 기존 전사문을 확인해야 합니다.' : '현재 QA 앱에는 검증 전 전사 모듈이 없습니다.'}
              </Text>}
          {transcriptionStatus ? <Text style={styles.recordingMeta}>{transcriptionStatus}</Text> : null}
          {transcriptionError ? <Text style={styles.errorText}>{transcriptionError}</Text> : null}
        </View>
        : <Text style={styles.minutesHelp}>자동 전사는 아직 연결 전입니다. 녹음을 들으며 직접 입력하거나 전사된 글을 붙여넣을 수 있습니다.</Text>}
        <Text style={styles.minutesLabel}>녹취문 (선택)</Text>
        <TextInput accessibilityLabel="회의 녹취문 직접 입력" style={styles.minutesInput} multiline textAlignVertical="top"
          value={transcriptText} maxLength={120000} editable={!loadFailed}
          placeholder="녹음에서 들은 내용을 입력하거나 붙여넣으세요."
          placeholderTextColor={mobileTheme.colors.textMuted}
          onLayout={event => { inputPositions.current.transcript = event.nativeEvent.layout.y; }}
          onFocus={() => {
            focusedInput.current = 'transcript';
            scrollRef.current?.scrollTo({ y: Math.max(0, inputPositions.current.transcript - 16), animated: true });
          }}
          onChangeText={value => { setTranscriptText(value); setNotice(''); }} />
        <Text style={styles.minutesLabel}>회의록 (수정 가능)</Text>
        <TextInput accessibilityLabel="회의록 내용" style={styles.minutesInput} multiline textAlignVertical="top"
          value={minutesText} maxLength={120000} editable={!loadFailed}
          placeholder="회의 내용·결정사항·후속 할 일을 직접 정리하세요."
          placeholderTextColor={mobileTheme.colors.textMuted}
          onLayout={event => { inputPositions.current.minutes = event.nativeEvent.layout.y; }}
          onFocus={() => {
            focusedInput.current = 'minutes';
            scrollRef.current?.scrollTo({ y: Math.max(0, inputPositions.current.minutes - 16), animated: true });
          }}
          onChangeText={value => { setMinutesText(value); setNotice(''); }} />
        <Text style={styles.minutesFootnote}>녹음 원본은 변경하지 않습니다. 공유는 직접 누를 때만 실행됩니다.</Text>
      </ScrollView>
      <View style={styles.minutesFooter}>
        {!loaded && !loadFailed ? <Text style={styles.recordingMeta}>기존 회의록을 확인하는 중입니다.</Text> : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {notice ? <Text style={styles.minutesSuccess}>{notice}</Text> : null}
        <View style={styles.minutesActions}>
          <Pressable accessibilityRole="button" accessibilityLabel="회의록 저장" disabled={!loaded || loadFailed}
            style={[styles.renamePrimary, !loaded || loadFailed ? styles.minutesDisabled : null]} onPress={saveDraft}>
            <Text style={styles.renamePrimaryText}>저장</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="회의록 공유"
            disabled={!saved || dirty || !loaded || loadFailed}
            style={[styles.renameSecondary, (!saved || dirty || !loaded || loadFailed) ? styles.minutesDisabled : null]}
            onPress={() => void shareSavedDraft()}>
            <Text style={styles.renameSecondaryText}>공유</Text>
          </Pressable>
        </View>
      </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  </Modal>;
}

export function MeetingRecordingLibrary({ refreshToken = 0 }: { refreshToken?: number }) {
  const [items, setItems] = useState<readonly MeetingRecordingEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [minutesRecording, setMinutesRecording] = useState<MeetingRecordingEntry | null>(null);
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(20);

  function reload() {
    try {
      setItems(listMeetingRecordings());
      setError('');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '회의 녹음 목록을 불러오지 못했습니다.');
    }
  }

  useEffect(() => { reload(); }, [refreshToken]);

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) || null,
    [items, selectedId],
  );
  const matchingItems = useMemo(() => searchMeetingRecordings(items, search), [items, search]);
  const visibleItems = useMemo(() => matchingItems.slice(0, visibleCount),
    [matchingItems, visibleCount]);

  function beginRename(recording: MeetingRecordingEntry) {
    setRenameId(recording.id);
    setRenameTitle(recording.title || '');
    setSelectedId(recording.id);
    setError('');
  }

  function saveRename() {
    if (!renameId) return;
    try {
      renameMeetingRecording(renameId, renameTitle);
      setRenameId(null);
      setRenameTitle('');
      reload();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '회의 녹음 이름을 변경하지 못했습니다.');
    }
  }

  function cancelRename() {
    setRenameId(null);
    setRenameTitle('');
  }

  function confirmDelete(recording: MeetingRecordingEntry) {
    Alert.alert(
      '회의 녹음 삭제',
      `${formatRecordedAt(recording.createdAt)} 녹음 파일을 삭제할까요? 연결된 회의록 문서는 유지됩니다.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: () => {
            try {
              deleteMeetingRecording(recording.id);
              if (selectedId === recording.id) setSelectedId(null);
              reload();
            } catch (nextError) {
              setError(nextError instanceof Error ? nextError.message : '회의 녹음을 삭제하지 못했습니다.');
            }
          },
        },
      ],
    );
  }

  return <View style={styles.library}>
    <View style={styles.libraryHead}>
      <View>
        <Text style={styles.libraryEyebrow}>기기 보관</Text>
        <Text style={styles.libraryTitle}>최근 회의 녹음</Text>
      </View>
      <Pressable accessibilityRole="button" style={styles.reloadAction} onPress={reload}>
        <Text style={styles.reloadText}>새로고침</Text>
      </Pressable>
    </View>

    <TextInput
      accessibilityLabel="회의 기록 검색"
      placeholder="회의명·날짜 검색"
      style={styles.recordingSearch}
      value={search}
      onChangeText={(value) => { setSearch(value); setVisibleCount(20); }}
    />
    {error ? <Text style={styles.errorText}>{error}</Text> : null}
    {!items.length && !error ? <Text style={styles.emptyText}>아직 저장된 회의 녹음이 없습니다.</Text> : null}
    {items.length > 0 ? <Text style={styles.recordingCount}>전체 {items.length}건 · 검색 결과 {matchingItems.length}건</Text> : null}
    {items.length > 0 && matchingItems.length === 0
      ? <Text style={styles.emptyText}>해당 회의명이나 날짜의 기록이 없습니다.</Text> : null}

    {visibleItems.map((recording, index) => {
      const active = recording.id === selectedId;
      const available = isMeetingRecordingFileAvailable(recording);
      const hasMinutes = hasMeetingMinutes(recording.id);
      const firstInMonth = index === 0 ||
        formatRecordingMonth(recording.createdAt) !== formatRecordingMonth(visibleItems[index - 1].createdAt);
      return <View key={recording.id} style={styles.recordingGroup}>
        {firstInMonth ? <Text style={styles.monthHeading}>{formatRecordingMonth(recording.createdAt)}</Text> : null}
        <View style={styles.recordingRow}>
        <Pressable
          accessibilityRole="button"
          style={styles.recordingMain}
          onPress={() => setSelectedId((current) => current === recording.id ? null : recording.id)}
        >
          <View style={styles.recordingIcon}><Text style={styles.recordingIconText}>🎙</Text></View>
          <View style={styles.recordingCopy}>
            <Text style={styles.recordingTitle}>{recording.title || `회의 녹음 · ${formatRecordedAt(recording.createdAt)}`}</Text>
            <Text style={styles.recordingMeta}>{formatRecordedAt(recording.createdAt)} · {formatDuration(recording.durationMs)} · {formatBytes(recording.sizeBytes)}</Text>
            <Text style={styles.recordingMeta}>{hasMinutes ? '회의록 있음' : '녹음만 있음'}{!available ? ' · 녹음 파일 없음' : ''}</Text>
            <Text style={styles.recordingFile} numberOfLines={1}>{recording.fileName}</Text>
          </View>
          <Text style={styles.expandText}>{active ? '접기' : '듣기'}</Text>
        </Pressable>

        {active && selected && available ? <MeetingRecordingPlayer recording={selected} /> : null}
        {active && !available ? <Text style={styles.errorText}>녹음 파일을 확인할 수 없습니다. 회의록 문서는 계속 열 수 있습니다.</Text> : null}

        {renameId === recording.id ? <View style={styles.renameEditor}>
          <TextInput
            accessibilityLabel="회의 녹음 이름"
            placeholder="예: 태장 홈페이지 개발회의"
            value={renameTitle}
            onChangeText={setRenameTitle}
            style={styles.renameInput}
            maxLength={120}
          />
          <View style={styles.renameActions}>
            <Pressable accessibilityRole="button" style={styles.renameSecondary} onPress={cancelRename}><Text style={styles.renameSecondaryText}>취소</Text></Pressable>
            <Pressable accessibilityRole="button" style={styles.renamePrimary} onPress={saveRename}><Text style={styles.renamePrimaryText}>이름 저장</Text></Pressable>
          </View>
        </View> : <View style={styles.rowActions}>
          <Pressable accessibilityRole="button" style={styles.renameAction} onPress={() => setMinutesRecording(recording)}>
            <Text style={styles.renameActionText}>회의록</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.renameAction} onPress={() => beginRename(recording)}>
            <Text style={styles.renameActionText}>이름 바꾸기</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.deleteAction} onPress={() => confirmDelete(recording)}>
            <Text style={styles.deleteText}>녹음 삭제</Text>
          </Pressable>
        </View>}
        </View>
      </View>;
    })}
    {matchingItems.length > visibleCount
      ? <Pressable accessibilityRole="button" style={styles.moreRecordings} onPress={() => setVisibleCount((count) => count + 20)}>
          <Text style={styles.reloadText}>20건 더 보기 ({matchingItems.length - visibleCount}건 남음)</Text>
        </Pressable>
      : null}
    {minutesRecording ? <MeetingMinutesEditor recording={minutesRecording} onClose={() => setMinutesRecording(null)} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  minutesKeyboard: { flex: 1, backgroundColor: mobileTheme.colors.surface },
  minutesModal: { flex: 1, backgroundColor: mobileTheme.colors.surface },
  minutesScroll: { flex: 1 },
  minutesFooter: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, borderTopWidth: 1, borderTopColor: mobileTheme.colors.border, backgroundColor: mobileTheme.colors.surface, gap: 6 },
  minutesHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: mobileTheme.colors.border },
  minutesHeading: { fontSize: 20, fontWeight: '800', color: mobileTheme.colors.text },
  minutesClose: { minHeight: 40, paddingHorizontal: 12, justifyContent: 'center' },
  minutesContent: { gap: 12, padding: 16, paddingBottom: 36 },
  minutesHelp: { fontSize: 13, color: mobileTheme.colors.textSecondary, lineHeight: 19 },
  transcriptionQaPanel: { gap: 10, padding: 12, borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: mobileTheme.radius.compact, backgroundColor: mobileTheme.colors.neutralBackground },
  transcriptPreview: { fontSize: 13, color: mobileTheme.colors.text, lineHeight: 20 },
  minutesLabel: { fontSize: 14, fontWeight: '800', color: mobileTheme.colors.text },
  minutesInput: { minHeight: 140, borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: mobileTheme.radius.compact, backgroundColor: mobileTheme.colors.neutralBackground, color: mobileTheme.colors.text, padding: 12, lineHeight: 20 },
  minutesActions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  minutesDisabled: { opacity: 0.45 },
  minutesSuccess: { fontSize: 13, color: mobileTheme.colors.success },
  minutesFootnote: { fontSize: 12, color: mobileTheme.colors.textMuted, lineHeight: 18 },
  library: { gap: 10, paddingTop: 8 },
  recordingSearch: { minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: mobileTheme.radius.compact, color: mobileTheme.colors.text, backgroundColor: mobileTheme.colors.surface },
  recordingCount: { fontSize: 12, color: mobileTheme.colors.textSecondary },
  recordingGroup: { gap: 6 },
  monthHeading: { fontSize: 13, fontWeight: '800', color: mobileTheme.colors.textSecondary, marginTop: 12 },
  moreRecordings: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: mobileTheme.radius.compact, borderWidth: 1, borderColor: mobileTheme.colors.border },
  libraryHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  libraryEyebrow: { fontSize: 11, fontWeight: '800', color: mobileTheme.colors.textMuted, letterSpacing: 0.7 },
  libraryTitle: { fontSize: 17, fontWeight: '800', color: mobileTheme.colors.text, marginTop: 2 },
  reloadAction: { minHeight: 38, paddingHorizontal: 12, justifyContent: 'center', borderRadius: mobileTheme.radius.compact, borderWidth: 1, borderColor: mobileTheme.colors.border, backgroundColor: mobileTheme.colors.surface },
  reloadText: { fontSize: 12, fontWeight: '800', color: mobileTheme.colors.link },
  recordingRow: { gap: 8, padding: 12, borderRadius: mobileTheme.radius.control, borderWidth: 1, borderColor: mobileTheme.colors.borderSubtle, backgroundColor: mobileTheme.colors.neutralBackground },
  recordingMain: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  recordingIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: mobileTheme.colors.surface },
  recordingIconText: { fontSize: 19 },
  recordingCopy: { flex: 1, minWidth: 0, gap: 2 },
  recordingTitle: { fontSize: 14, fontWeight: '800', color: mobileTheme.colors.text },
  recordingMeta: { fontSize: 12, color: mobileTheme.colors.textSecondary },
  recordingFile: { fontSize: 10, color: mobileTheme.colors.textMuted },
  expandText: { fontSize: 12, fontWeight: '800', color: mobileTheme.colors.link },
  player: { gap: 8, paddingTop: 4 },
  playerProgressRow: { flexDirection: 'row', justifyContent: 'space-between' },
  playerTime: { fontSize: 11, color: mobileTheme.colors.textMuted, fontVariant: ['tabular-nums'] },
  playerActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  smallAction: { minHeight: 40, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: mobileTheme.radius.compact, borderWidth: 1, borderColor: mobileTheme.colors.border, backgroundColor: mobileTheme.colors.surface },
  smallActionText: { fontSize: 12, fontWeight: '700', color: mobileTheme.colors.textSecondary },
  playAction: { minHeight: 44, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderRadius: mobileTheme.radius.control, backgroundColor: mobileTheme.colors.primary },
  playActionText: { fontSize: 13, fontWeight: '800', color: mobileTheme.colors.primaryText },
  rowActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8 },
  renameAction: { minHeight: 34, paddingHorizontal: 10, justifyContent: 'center' },
  renameActionText: { fontSize: 12, fontWeight: '800', color: mobileTheme.colors.link },
  renameEditor: { gap: 8, paddingTop: 4 },
  renameInput: { minHeight: 42, borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: mobileTheme.radius.compact, paddingHorizontal: 11, backgroundColor: mobileTheme.colors.surface, color: mobileTheme.colors.text },
  renameActions: { flexDirection: 'row', gap: 8 },
  renameSecondary: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: mobileTheme.radius.compact, borderWidth: 1, borderColor: mobileTheme.colors.border, backgroundColor: mobileTheme.colors.surface },
  renameSecondaryText: { fontSize: 12, fontWeight: '800', color: mobileTheme.colors.textSecondary },
  renamePrimary: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: mobileTheme.radius.compact, backgroundColor: mobileTheme.colors.primary },
  renamePrimaryText: { fontSize: 12, fontWeight: '800', color: mobileTheme.colors.primaryText },
  deleteAction: { alignSelf: 'flex-end', minHeight: 34, paddingHorizontal: 10, justifyContent: 'center' },
  deleteText: { fontSize: 12, fontWeight: '800', color: mobileTheme.colors.danger },
  emptyText: { fontSize: 13, color: mobileTheme.colors.textMuted, lineHeight: 19, paddingVertical: 8 },
  errorText: { fontSize: 12, color: mobileTheme.colors.danger, lineHeight: 18 },
});
