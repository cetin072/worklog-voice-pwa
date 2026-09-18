import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  deleteMeetingRecording,
  listMeetingRecordings,
  renameMeetingRecording,
  type MeetingRecordingEntry,
} from './meeting-recordings';
import { mobileTheme } from '@/src/ui/theme';

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

  function togglePlayback() {
    if (status.playing) {
      player.pause();
      return;
    }
    if (status.didJustFinish && durationSeconds > 0) {
      void player.seekTo(0).then(() => player.play());
      return;
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
      <Pressable accessibilityRole="button" style={styles.playAction} onPress={togglePlayback}>
        <Text style={styles.playActionText}>{status.playing ? '⏸ 일시정지' : status.didJustFinish ? '↻ 다시 듣기' : '▶ 재생'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" style={styles.smallAction} onPress={() => seekBy(15)}>
        <Text style={styles.smallActionText}>15초 ↷</Text>
      </Pressable>
    </View>
    {status.error ? <Text style={styles.errorText}>재생 오류: {status.error}</Text> : null}
  </View>;
}

export function MeetingRecordingLibrary({ refreshToken = 0 }: { refreshToken?: number }) {
  const [items, setItems] = useState<readonly MeetingRecordingEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState('');

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
      `${formatRecordedAt(recording.createdAt)} 녹음 파일을 이 기기에서 삭제할까요?`,
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

    {error ? <Text style={styles.errorText}>{error}</Text> : null}
    {!items.length ? <Text style={styles.emptyText}>아직 저장된 회의 녹음이 없습니다.</Text> : null}

    {items.slice(0, 20).map((recording) => {
      const active = recording.id === selectedId;
      return <View key={recording.id} style={styles.recordingRow}>
        <Pressable
          accessibilityRole="button"
          style={styles.recordingMain}
          onPress={() => setSelectedId((current) => current === recording.id ? null : recording.id)}
        >
          <View style={styles.recordingIcon}><Text style={styles.recordingIconText}>🎙</Text></View>
          <View style={styles.recordingCopy}>
            <Text style={styles.recordingTitle}>{recording.title || `회의 녹음 · ${formatRecordedAt(recording.createdAt)}`}</Text>
            <Text style={styles.recordingMeta}>{formatDuration(recording.durationMs)} · {formatBytes(recording.sizeBytes)} · {recording.mimeType}</Text>
            <Text style={styles.recordingFile} numberOfLines={1}>{recording.fileName}</Text>
          </View>
          <Text style={styles.expandText}>{active ? '접기' : '듣기'}</Text>
        </Pressable>

        {active && selected ? <MeetingRecordingPlayer recording={selected} /> : null}

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
          <Pressable accessibilityRole="button" style={styles.renameAction} onPress={() => beginRename(recording)}>
            <Text style={styles.renameActionText}>이름 바꾸기</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.deleteAction} onPress={() => confirmDelete(recording)}>
            <Text style={styles.deleteText}>삭제</Text>
          </Pressable>
        </View>}
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  library: { gap: 10, paddingTop: 8 },
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
