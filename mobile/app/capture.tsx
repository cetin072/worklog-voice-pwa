import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlatform } from '@/src/providers/platform-provider';
import { getFreshAccessToken } from '@/src/platform/authenticated-access';
import { WorkRecordEditSheet } from '@/src/features/work/work-record-edit-sheet';
import { captureInbox, processCapture, readWorklogDetails, editCapture, undoCapture } from '@/src/features/capture/capture-runtime';
import type { CaptureEntry } from '@/src/features/capture/capture-inbox';

export default function CaptureScreen() {
  const { session, client } = usePlatform();
  const owner = session?.user.id || null;
  const { hash, error: incomingError } = useLocalSearchParams<{ hash?: string; error?: string }>();
  const router = useRouter(); const insets = useSafeAreaInsets();
  const [entry, setEntry] = useState<CaptureEntry | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [editing, setEditing] = useState(false); const [editLoading, setEditLoading] = useState(false);
  const [title, setTitle] = useState(''); const [date, setDate] = useState(''); const [time, setTime] = useState('');
  const [editReady, setEditReady] = useState(false); const [editError, setEditError] = useState('');
  const epoch = useRef(0);
  const receive = useCallback(async () => {
    const current = ++epoch.current; setBusy(true);setError('');
    try {
      if (incomingError) throw new Error('CAPTURE_RECEIVE_FAILED');
      let next = hash ? await captureInbox.get(hash, owner) : await captureInbox.pending(owner);
      if (!next && hash && owner) {
        const anonymous = await captureInbox.get(hash, null);
        if (anonymous) next = await captureInbox.claim(hash, owner);
      }
      if (!next && !owner) next = hash ? await captureInbox.get(hash, null) : await captureInbox.pending(null);
      if (!next) throw new Error('공유한 이미지가 준비되지 않았습니다. 이미지 한 장을 다시 공유해주세요.');
      if (current !== epoch.current) return;
      setEntry(next);
      if (owner && client && !next.undone) {
        next = await processCapture(next, client, owner);
        if (current !== epoch.current) return;
        setEntry(next);
      }
    } catch (e) {
      if (current === epoch.current) setError(e instanceof Error && e.message === 'CAPTURE_NO_TEXT'
        ? '글자를 읽지 못했습니다. 다시 공유하거나 직접 입력해주세요.'
        : '자동 저장을 마치지 못했습니다. 이미지는 보관되어 있습니다. 로그인·네트워크를 확인하고 다시 시도해주세요.');
    } finally { if (current === epoch.current) setBusy(false); }
  }, [hash, owner, client, incomingError]);
  useEffect(() => { setEntry(null);setEditing(false);void receive();return () => { epoch.current++; }; }, [receive]);
  const visible = entry && entry.owner === owner ? entry : !owner && entry?.owner === null ? entry : null;
  const id = visible?.saved?.dataCoreWorkRecordId || visible?.saved?.pageId;
  async function openEditor() {
    if (!client || !id || busy) return;
    const current = ++epoch.current; setEditing(true); setEditLoading(true);setEditReady(false);setEditError('');
    try {
      const details = await readWorklogDetails(await getFreshAccessToken(client), id);
      if (current !== epoch.current) return;
      setTitle(details.title);setDate(details.dueDate);setTime(details.dueTime);setEditReady(true);
    } catch { if (current === epoch.current) setEditError('저장된 정보를 읽지 못했습니다. 다시 시도해주세요.'); }
    finally { if (current === epoch.current) setEditLoading(false); }
  }
  async function saveEdit() {
    if (!client || !visible || busy || !editReady) return;
    const current = epoch.current; setBusy(true);setEditError('');
    try {
      await editCapture(client, visible, { title, dueDate: date, dueTime: time });
      if (current === epoch.current) {
        const next = { ...visible, details: { title, dueDate: date, dueTime: time }, decision: visible.decision ? { ...visible.decision, title, date, time } : undefined };
        await captureInbox.put(next);setEntry(next);setEditing(false);
      }
    } catch { if (current === epoch.current) setEditError('수정 또는 알림 갱신을 마치지 못했습니다. 입력은 유지됩니다. 다시 시도해주세요.'); }
    finally { if (current === epoch.current) setBusy(false); }
  }
  async function undo() {
    if (!client || !visible || busy) return;
    const current = epoch.current; setBusy(true);setError('');
    try { const next = await undoCapture(client, visible);if (current === epoch.current) setEntry(next); }
    catch { if (current === epoch.current) setError('취소 또는 알림 정리를 마치지 못했습니다. 다시 시도해주세요.'); }
    finally { if (current === epoch.current) setBusy(false); }
  }
  async function leave(manual = false) {
    if (visible && !visible.saved) await captureInbox.put({ ...visible, paused: true });
    router.replace(manual ? '/capture-manual' : '/');
  }
  const Button = ({ label, action }: { label: string; action(): void }) => <Pressable accessibilityRole="button" disabled={busy} onPress={action} style={styles.button}><Text style={styles.buttonText}>{label}</Text></Pressable>;
  return <View style={[styles.page, { paddingTop: insets.top, paddingBottom: insets.bottom }]}><ScrollView contentContainerStyle={styles.content}>
    <Text accessibilityRole="header" style={styles.heading}>캡처에서 일정 등록</Text>
    {busy ? <View style={styles.card}><ActivityIndicator /><Text>이미지 확인·저장 중…</Text></View> : null}
    {!owner ? <View style={styles.card}><Text>이미지는 이 기기에 보관했습니다. 로그인하면 자동으로 저장합니다.</Text><Button label="로그인하기" action={() => router.replace('/')} /></View> : null}
    {visible?.saved ? <View style={styles.card}>
      <Text accessibilityLiveRegion="polite" style={styles.title}>{visible.undone ? '등록을 취소했습니다.' : visible.saved.scheduleCreated ? '일정을 저장했습니다.' : '확인 필요 기록으로 저장했습니다.'}</Text>
      {!visible.undone ? <><Text style={styles.title}>{visible.details?.title || visible.decision?.title}</Text><Text>{visible.details?.dueDate || visible.decision?.date || '날짜 확인 필요'} {visible.details?.dueTime || visible.decision?.time || ''}</Text><Text>{visible.decision?.description}</Text>
        {visible.reminderWarning ? <Text>{visible.reminderWarning}</Text> : null}
        <Button label="수정" action={() => void openEditor()} /><Button label="실행 취소" action={() => void undo()} /></> : null}
    </View> : null}
    {error ? <View style={styles.card}><Text accessibilityLiveRegion="polite">{error}</Text><Button label="다시 시도" action={() => void receive()} /><Button label="직접 입력" action={() => void leave(true)} /></View> : null}
    <Button label="업무수첩으로" action={() => void leave()} />
  </ScrollView><WorkRecordEditSheet visible={editing} title={title} date={date} time={time} loading={editLoading} saving={busy} ready={editReady}
    statusText={editError} statusTone={editError ? 'error' : 'neutral'} onTitle={setTitle} onDate={setDate} onTime={setTime}
    onSave={() => void saveEdit()} onCancel={() => { epoch.current++;setEditing(false); }} onRetry={() => void openEditor()} /></View>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f2f5f8' },content: { padding: 20, gap: 16 },
  heading: { fontSize: 25, fontWeight: '800', color: '#103244' },title: { fontSize: 18, fontWeight: '700' },
  card: { padding: 18, gap: 12, borderRadius: 18, backgroundColor: '#fff' },
  button: { minHeight: 48, padding: 12, borderRadius: 12, backgroundColor: '#dcebf3', justifyContent: 'center' },buttonText: { color: '#103244', fontSize: 17, fontWeight: '700' },
});
