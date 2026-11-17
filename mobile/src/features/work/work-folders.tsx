import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import type { BriefingTask, WorkJournalRecord } from '@/src/platform/worklog-api';
import { loadWorkJournalDay } from '@/src/platform/worklog-api';
import { getFreshAccessToken } from '@/src/platform/authenticated-access';
import { mobileTheme } from '@/src/ui/theme';
import { seoulDate } from '../home/home-calendar-model';
import { canMoveFolder, folderPath, loadFolderRecords, loadFolders, organizeRecord, saveFolder, PAGE_SIZE, TODAY_POLICY, type FolderRecord, type WorkFolder, type WorkSection } from './work-folders-store';

type Props = { client: PlatformSupabaseClient; userId: string; home?: boolean; revision: number; busy: boolean; onComplete: (task: BriefingTask) => Promise<void>; onInput: () => void };
export function WorkFolders({ client, userId, home = false, revision, busy: externalBusy, onComplete, onInput }: Props) {
  const [folders, setFolders] = useState<WorkFolder[]>([]);
  const [folder, setFolder] = useState<string | null>(null);
  const [section, setSection] = useState<WorkSection>(home ? 'today' : 'tasks');
  const [records, setRecords] = useState<FolderRecord[]>([]);
  const [completed, setCompleted] = useState<WorkJournalRecord[]>([]);
  const [error, setError] = useState('');
  const [journalLoading, setJournalLoading] = useState(home);
  const [journalError, setJournalError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [more, setMore] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [editor, setEditor] = useState<WorkFolder | null>(null);
  const [moving, setMoving] = useState<FolderRecord | WorkFolder | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const epoch = useRef(0), locked = useRef(false), mounted = useRef(true);
  const today = seoulDate();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  useEffect(() => {
    const request = ++epoch.current;
    setLoading(true); setReady(false); setError(''); setRecords([]); setMore(false);
    void Promise.all([loadFolders(client), loadFolderRecords(client, folder, section)])
      .then(([nextFolders, rows]) => { if (request !== epoch.current) return; setFolders(nextFolders); setRecords(rows); setNextOffset(rows.length); setMore(rows.length === PAGE_SIZE); setReady(true); })
      .catch(e => { if (request === epoch.current) setError(e.message); })
      .finally(() => { if (request === epoch.current) setLoading(false); });
    if (home) {
      setCompleted([]); setJournalError(''); setJournalLoading(true);
      void getFreshAccessToken(client).then(token => loadWorkJournalDay(token, today))
        .then(day => { if (request === epoch.current) setCompleted(day.completed); })
        .catch(() => { if (request === epoch.current) setJournalError('오늘 끝낸 일을 불러오지 못했습니다. 새로고침해주세요.'); })
        .finally(() => { if (request === epoch.current) setJournalLoading(false); });
    }
    return () => { epoch.current++; };
  }, [client, folder, section, revision, refresh, today, home]);

  async function mutate(action: () => Promise<void>) {
    if (locked.current || externalBusy) return;
    locked.current = true; setBusy(true); setError('');
    try {
      await action();
      if (!mounted.current) return;
      setEditor(null); setMoving(null); setRefresh(n => n + 1);
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : '저장 확인이 필요합니다. 새로고침해주세요.'); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  async function loadMore() {
    if (locked.current || loading) return;
    locked.current = true; setLoading(true);
    const request = epoch.current;
    try {
      const rows = await loadFolderRecords(client, folder, section, nextOffset);
      if (request === epoch.current) { setRecords(current => [...current, ...rows.filter(row => !current.some(item => item.id === row.id))]); setNextOffset(nextOffset + rows.length); setMore(rows.length === PAGE_SIZE); }
    } catch (e) { if (request === epoch.current) setError(e instanceof Error ? e.message : '더 불러오지 못했습니다.'); }
    finally { locked.current = false; if (request === epoch.current) setLoading(false); }
  }
  const disabled = busy || externalBusy || loading;
  const button = (label: string, action: () => void, off = disabled, text = label) => <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={off} style={[styles.button, off && styles.disabled]} onPress={action}><Text style={styles.buttonText}>{text}</Text></Pressable>;
  const currentFolder = folders.find(item => item.id === folder);
  return <View style={styles.card}>
    <View style={styles.actions}><Text style={styles.title}>{home ? '오늘 하기' : '업무'}</Text>{button('새로고침', () => setRefresh(n => n + 1), busy || externalBusy)}</View>
    <Text style={styles.help}>{home ? TODAY_POLICY : '날짜 없이 먼저 등록하세요. 폴더는 나중에 정해도 됩니다.'}</Text>
    {!home ? <>
      {button('업무·메모 등록', onInput, busy || externalBusy)}
      <Text style={styles.path}>{folder ? folderPath(folders, folder) : '내 폴더 / 미분류'}</Text>
      {folder ? button('상위 폴더', () => { setFolder(currentFolder?.parent_id || null); setExpanded(null); }) : null}
      <View style={styles.actions}>
        {folders.filter(item => item.parent_id === folder).map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.name} 폴더 열기`} style={styles.folder} disabled={disabled} onPress={() => { setFolder(item.id); setExpanded(null); }}><Text style={styles.text}>📁 {item.name}</Text></Pressable>)}
      </View>
      <View style={styles.actions}>
        {button(folder ? '하위 폴더 만들기' : '폴더 만들기', () => setEditor({ id: randomUUID(), name: '', parent_id: folder, version: -1 }), disabled || !ready)}
        {currentFolder ? <>{button('폴더 이름 변경', () => setEditor({ ...currentFolder }))}{button('폴더 이동', () => setMoving(currentFolder))}</> : null}
      </View>
      <View style={styles.actions}>{([['tasks', '할 일'], ['notes', '메모·자료'], ['completed', '완료']] as const).map(([key, label]) => <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: section === key }} disabled={busy || externalBusy} style={[styles.tab, section === key && styles.active]} onPress={() => { setSection(key); setExpanded(null); }}><Text style={section === key ? styles.activeText : styles.text}>{label}</Text></Pressable>)}</View>
    </> : null}
    {editor ? <View style={styles.editor}>
      <Text style={styles.text}>{editor.version === -1 ? '새 폴더' : '이름 변경'}</Text>
      <TextInput accessibilityLabel="폴더 이름" value={editor.name} maxLength={60} editable={!busy} style={styles.input} onChangeText={name => setEditor({ ...editor, name })} />
      <View style={styles.actions}>{button('폴더 저장', () => void mutate(() => saveFolder(client, editor, userId)), disabled || !editor.name.trim())}{button('편집 취소', () => setEditor(null), busy)}</View>
    </View> : null}
    {moving ? <View style={styles.editor}>
      <Text style={styles.text}>이동할 곳 선택 · {'title' in moving ? moving.title : moving.name}</Text>
      {[null, ...folders.filter(item => 'title' in moving || canMoveFolder(folders, moving.id, item.id)).map(item => item.id)].map(id => <View key={id || 'root'}>{button(id ? folderPath(folders, id) : ('title' in moving ? '미분류로 이동' : '최상위로 이동'), () => void mutate(() => 'title' in moving ? organizeRecord(client, moving, { folder: id }, userId) : saveFolder(client, { ...moving, parent_id: id }, userId)))}</View>)}
      {button('이동 취소', () => setMoving(null), busy)}
    </View> : null}
    {loading ? <Text accessibilityLiveRegion="polite" style={styles.help}>불러오는 중…</Text> : null}
    {busy ? <Text accessibilityLiveRegion="polite" style={styles.help}>저장 확인 중…</Text> : null}
    {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
    {ready && !records.length ? <Text style={styles.help}>{home ? '업무 탭에서 날짜 없는 할 일을 골라보세요.' : '이 폴더에 해당 기록이 없습니다.'}</Text> : null}
    {records.map(record => <View key={record.id} style={styles.record}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${record.title} 내용 보기`} accessibilityState={{ expanded: expanded === record.id }} style={styles.open} onPress={() => setExpanded(value => value === record.id ? null : record.id)}><Text style={styles.text}>{record.status === 'completed' ? '✓ ' : ''}{record.title}</Text><Text style={styles.help}>{home ? `${folderPath(folders, record.folder_id)} · ` : ''}{record.due_at ? `기한 ${seoulDate(record.due_at)}` : '날짜 없음'}{record.selected_on ? ' · 오늘 선택됨' : ''}</Text></Pressable>
      {expanded === record.id ? <Text selectable style={styles.text}>{record.content || record.original_text || '추가 본문이 없습니다.'}</Text> : null}
      <View style={styles.actions}>
        {record.status !== 'completed' && record.action_kind !== 'note' ? <>
          {button(`${record.title} 완료`, () => void mutate(() => onComplete({ pageId: record.id, title: record.title, status: record.status === 'waiting' ? '대기' : record.status === 'needs_review' ? '확인필요' : '진행중', nextAttentionAt: record.next_attention_at || undefined })), disabled, '완료')}
          {!record.due_at || record.selected_on ? button(record.selected_on ? '오늘 선택 해제' : '오늘 하기', () => void mutate(() => organizeRecord(client, record, { today: !record.selected_on }, userId))) : null}
        </> : null}
        {!home ? button(`${record.title} 폴더 이동`, () => setMoving(record), disabled, '폴더 이동') : null}
      </View>
    </View>)}
    {more ? button('더 불러오기', () => void loadMore()) : null}
    {home ? <View style={styles.record}><Text style={styles.title}>오늘 끝낸 일</Text>{journalLoading ? <Text style={styles.help}>완료 기록을 불러오는 중…</Text> : journalError ? <Text style={styles.error}>{journalError}</Text> : completed.length ? completed.map(record => <Text key={record.pageId} style={styles.text}>✓ {record.title}</Text>) : <Text style={styles.help}>오늘 완료한 업무가 없습니다.</Text>}</View> : null}
  </View>;
}
const styles = StyleSheet.create({
  card: { padding: 16, gap: 12, backgroundColor: mobileTheme.colors.surface, borderRadius: mobileTheme.radius.card, borderWidth: 1, borderColor: mobileTheme.colors.border },
  title: { fontSize: 19, fontWeight: '700', color: mobileTheme.colors.text },
  text: { color: mobileTheme.colors.text, fontSize: 16, lineHeight: 24 },
  help: { color: mobileTheme.colors.textSecondary, fontSize: 13, lineHeight: 20 },
  path: { fontSize: 15, color: mobileTheme.colors.text, fontWeight: '600' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  button: { minHeight: mobileTheme.size.touchTarget, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: mobileTheme.radius.control, backgroundColor: mobileTheme.colors.primary, maxWidth: '100%' },
  buttonText: { color: mobileTheme.colors.primaryText, fontSize: 14 },
  disabled: { opacity: 0.5 },
  folder: { minHeight: 46, justifyContent: 'center', padding: 10, borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: 12, maxWidth: '100%' },
  tab: { padding: 12, minHeight: 46, borderRadius: 12, backgroundColor: mobileTheme.colors.background },
  active: { backgroundColor: mobileTheme.colors.primary }, activeText: { color: mobileTheme.colors.primaryText, fontSize: 16 },
  editor: { padding: 12, gap: 10, borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: 12 },
  input: { minHeight: 48, padding: 12, borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: 12, color: mobileTheme.colors.text },
  record: { gap: 8, paddingVertical: 10, borderTopWidth: 1, borderTopColor: mobileTheme.colors.borderSubtle },
  open: { minHeight: 46, gap: 4, justifyContent: 'center' },
  error: { color: mobileTheme.colors.danger, lineHeight: 22 },
});
