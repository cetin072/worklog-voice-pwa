import { WorkDocuments } from './work-documents';
import { workspaceStyles } from '@/src/ui/workspace-styles';
import { recordRowStyles } from '@/src/ui/record-row-styles';
import { RecordCompleteButton } from '@/src/ui/record-complete-button';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import type { BriefingNote, BriefingTask } from '@/src/platform/worklog-api';
import { mobileTheme } from '@/src/ui/theme';
import { seoulDate } from '../home/home-calendar-model';
import { canMoveFolder, folderPath, loadWorkOverview, organizeRecord, saveFolder, type FolderRecord, type WorkFolder, type WorkOverview, type WorkScope, type WorkSection } from './work-folders-store';

type Props = {
  initialFolder?: string | null; initialSection?: WorkSection; onViewChange?: (scope: WorkScope, section: WorkSection) => void; client: PlatformSupabaseClient;
  userId: string; revision: number; busy: boolean;
  onComplete: (task: BriefingTask) => Promise<void>; onCompleteNote: (note: BriefingNote) => Promise<void>;
  onJournal: () => void; onSearch: () => void;
  onEdit: (record: FolderRecord) => void; onDelete: (record: FolderRecord) => void; onReminder: (record: FolderRecord) => void;
  onReview?: (record: FolderRecord) => void;
};
export function WorkFolders({ client, userId, revision, initialFolder, initialSection = 'tasks', busy: externalBusy,
  onViewChange, onComplete, onCompleteNote, onJournal, onSearch, onEdit, onDelete, onReminder, onReview }: Props) {
  // undefined means all; null explicitly means unclassified (including after conversion).
  const [scope, setScope] = useState<WorkScope>(initialFolder === undefined ? 'all' : initialFolder);
  const [section, setSection] = useState<WorkSection>(initialSection);
  const [snapshot, setSnapshot] = useState<WorkOverview | null>(null);
  const [loadedKey, setLoadedKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [editor, setEditor] = useState<WorkFolder | null>(null);
  const [moving, setMoving] = useState<FolderRecord | WorkFolder | null>(null);
  const [menu, setMenu] = useState<'workspace' | FolderRecord | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const epoch = useRef(0), locked = useRef(false), mounted = useRef(true);
  const folderNameInput = useRef<TextInput>(null);
  const key = `${scope}:${section}`;
  const folders = snapshot?.folders || [];
  const currentFolder = folders.find(item => item.id === scope);
  const sameScope = loadedKey === key;
  const records = sameScope ? snapshot?.records || [] : [];
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  useEffect(() => { setScope(initialFolder === undefined ? 'all' : initialFolder); setSection(initialSection); }, [initialFolder, initialSection]);
  useEffect(() => { onViewChange?.(scope, section); }, [scope, section]);
  useEffect(() => {
    const request = ++epoch.current;
    // Keep confirmed counts and rows during refresh. A different scope never shows old rows.
    setLoading(true); setError('');
    void loadWorkOverview(client, scope, section)
      .then(next => { if (request === epoch.current) { setSnapshot(next); setNextOffset(next.records.length); setLoadedKey(key); } })
      .catch(e => { if (request === epoch.current) setError(e.message); })
      .finally(() => { if (request === epoch.current) setLoading(false); });
    return () => { epoch.current++; };
  }, [client, scope, section, revision, refresh]);

  async function mutate(action: () => Promise<void>) {
    if (locked.current || externalBusy) return;
    locked.current = true; setBusy(true); setError('');
    try {
      await action();
      if (!mounted.current) return;
      setEditor(null); setMoving(null); setMenu(null); setRefresh(n => n + 1);
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : '저장 확인이 필요합니다. 새로고침해주세요.'); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  async function loadMore() {
    if (locked.current || loading || !snapshot || !sameScope) return;
    locked.current = true; setLoading(true); setError('');
    const request = epoch.current;
    try {
      const next = await loadWorkOverview(client, scope, section, nextOffset);
      if (request === epoch.current) { setNextOffset(nextOffset + next.records.length); setSnapshot(current => current && ({ ...next, records: [...current.records, ...next.records.filter(row => !current.records.some(item => item.id === row.id))] })); }
    } catch (e) { if (request === epoch.current) setError(e instanceof Error ? e.message : '더 불러오지 못했습니다.'); }
    finally { locked.current = false; if (request === epoch.current) setLoading(false); }
  }
  const disabled = busy || externalBusy || loading;
  const button = (label: string, action: () => void, off = disabled, text = label) => <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={off} style={[styles.button, off && styles.disabled]} onPress={action}><Text style={styles.buttonText}>{text}</Text></Pressable>;
  const closeDialog = () => { if (!busy) { setEditor(null); setMoving(null); setMenu(null); } };
  const scopeButton = (value: WorkScope, label: string, count?: number) => <Pressable key={value ?? 'unclassified'} accessibilityRole="button" accessibilityLabel={`${label} ${count ?? '확인 중'}개 할 일`} accessibilityState={{ selected: scope === value }} disabled={busy || externalBusy} style={[styles.folder, scope === value && styles.active]} onPress={() => { setScope(value); setExpanded(null); }}><Text style={[styles.folderName, scope === value && styles.selectedText]}>{label}</Text><Text style={styles.count}>{count ?? '—'}</Text></Pressable>;
  return <View style={styles.card}>
    <View style={styles.heading}><Text style={styles.title}>업무</Text><View style={styles.actions}>
      <Pressable accessibilityRole="button" accessibilityLabel="새로고침" disabled={disabled} style={styles.refresh} onPress={() => setRefresh(n => n + 1)}><Text style={styles.link}>새로고침</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="업무 메뉴" style={styles.menuButton} disabled={busy || externalBusy} onPress={() => setMenu('workspace')}><Text style={styles.text}>⋯</Text></Pressable>
    </View></View>
    <View style={styles.heading}><Text style={styles.help}>폴더 · 남은 할 일</Text><Pressable accessibilityRole="button" accessibilityLabel={currentFolder ? '하위 폴더 만들기' : '폴더 만들기'} style={styles.refresh} disabled={disabled || !snapshot} onPress={() => setEditor({ id: randomUUID(), name: '', parent_id: currentFolder?.id || null, version: -1 })}><Text style={styles.link}>＋ 폴더</Text></Pressable></View>
    <View style={styles.folders}>
      {scopeButton('all', '전체', snapshot?.all_tasks)}
      {scopeButton(null, '미분류', snapshot?.unclassified_tasks)}
      {folders.map(item => scopeButton(item.id, folderPath(folders, item.id), item.task_count))}
    </View>
    <Text style={styles.scopeLabel}>{scope === 'all' ? '전체 업무' : scope === null ? '미분류' : folderPath(folders, scope)}{currentFolder && folders.some(item => item.parent_id === currentFolder.id) ? ' · 하위 폴더 포함' : ''}</Text>
    <View style={styles.tabs}>{([['tasks', '할 일'], ['notes', '메모·자료'], ['completed', '완료']] as const).map(([value, label]) => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: section === value }} disabled={busy || externalBusy} style={[styles.tab, section === value && styles.active]} onPress={() => { setSection(value); setExpanded(null); }}><Text style={[styles.tabText, section === value && styles.selectedText]}>{label}</Text></Pressable>)}</View>
    {section === 'notes' ? <WorkDocuments client={client} owner={userId} scope={scope} folders={folders} revision={`${revision}:${refresh}`} /> : null}
    {section === 'completed' ? <Pressable accessibilityRole="button" accessibilityLabel="날짜별 업무일지" style={styles.refresh} onPress={onJournal}><Text style={styles.link}>날짜별 업무일지 ›</Text></Pressable> : null}
    {loading ? <Text accessibilityLiveRegion="polite" style={styles.help}>{snapshot ? '갱신 중…' : '불러오는 중…'}</Text> : null}
    {busy ? <Text accessibilityLiveRegion="polite" style={styles.help}>저장 확인 중…</Text> : null}
    {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
    {sameScope && !loading && !error && !records.length ? <Text style={styles.empty}>{section === 'completed' ? '완료한 기록이 없습니다.' : section === 'notes' ? '짧은 메모가 없습니다.' : '남은 할 일이 없습니다.'}</Text> : null}
    {records.map(record => <View key={record.id} style={styles.record}>
      <View style={styles.recordLine}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${record.title} 내용 보기`} accessibilityState={{ expanded: expanded === record.id }} style={styles.open} onPress={() => setExpanded(value => value === record.id ? null : record.id)}>
          <Text style={styles.text}>{section === 'completed' ? '✓ ' : ''}{record.title}</Text>
          {scope === 'all' || (currentFolder && record.folder_id !== currentFolder.id) ? <Text style={styles.help}>{folderPath(folders, record.folder_id)}</Text> : null}
          {section === 'completed' ? <Text style={styles.help}>완료 {record.completed_at || record.acknowledged_at ? seoulDate(record.completed_at || record.acknowledged_at!) : '날짜 미확인'}</Text> : record.due_at ? <Text style={styles.help}>기한 {seoulDate(record.due_at)}</Text> : null}
        </Pressable>
        <View style={styles.recordActions}>
          <View style={styles.actions}>
            {section !== 'completed' ? <Pressable accessibilityRole="button" accessibilityLabel={`${record.title} 수정`} style={recordRowStyles.inlineEdit} disabled={disabled} onPress={() => onEdit(record)}><Text style={recordRowStyles.inlineEditText}>✏️</Text></Pressable> : null}
            <Pressable accessibilityRole="button" accessibilityLabel={`${record.title} 더 보기`} style={styles.menuButton} disabled={disabled} onPress={() => setMenu(record)}><Text style={styles.text}>⋯</Text></Pressable>
          </View>
          {section !== 'completed' ? <RecordCompleteButton label={`${record.title} 완료`} disabled={disabled} onPress={() => void mutate(() => record.action_kind === 'note' ? onCompleteNote({ pageId: record.id, title: record.title }) : onComplete({ pageId: record.id, title: record.title, status: record.status === 'waiting' ? '대기' : record.status === 'needs_review' ? '확인필요' : '진행중', nextAttentionAt: record.next_attention_at || undefined }))} /> : null}
        </View>
      </View>
      {expanded === record.id ? <Text selectable style={styles.body}>{record.content || record.original_text || '추가 본문이 없습니다.'}</Text> : null}
    </View>)}
    {sameScope && snapshot && nextOffset < snapshot.total_count ? button('더 불러오기', () => void loadMore()) : null}
    {editor || moving || menu ? <Modal transparent animationType="fade" onShow={() => editor && folderNameInput.current?.focus()} onRequestClose={closeDialog}>
      <KeyboardAvoidingView style={styles.editorOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.editorScroll} contentContainerStyle={styles.editorContent} keyboardShouldPersistTaps="handled">
          <View style={styles.editorDialog} accessibilityViewIsModal>
            {editor ? <>
              <Text accessibilityRole="header" style={styles.title}>{editor.version === -1 ? '새 폴더' : '폴더 이름 변경'}</Text>
              <TextInput ref={folderNameInput} accessibilityLabel="폴더 이름" placeholder="폴더 이름" value={editor.name} maxLength={60} editable={!busy} style={styles.input} onChangeText={name => setEditor({ ...editor, name })} returnKeyType="done" onSubmitEditing={() => { if (!disabled && editor.name.trim()) void mutate(() => saveFolder(client, editor, userId)); }} />
              {button('폴더 저장', () => void mutate(() => saveFolder(client, editor, userId)), disabled || !editor.name.trim())}
            </> : moving ? <>
              <Text accessibilityRole="header" style={styles.title}>폴더 이동</Text><Text style={styles.help}>{'title' in moving ? moving.title : moving.name}</Text>
              {[null, ...folders.filter(item => 'title' in moving || canMoveFolder(folders, moving.id, item.id)).map(item => item.id)].map(id => <View key={id || 'root'}>{button(id ? folderPath(folders, id) : ('title' in moving ? '미분류로 이동' : '최상위로 이동'), () => void mutate(() => 'title' in moving ? organizeRecord(client, moving, { folder: id }, userId) : saveFolder(client, { ...moving, parent_id: id }, userId)))}</View>)}
            </> : menu === 'workspace' ? <>
              <Text accessibilityRole="header" style={styles.title}>업무 메뉴</Text>
              {button('과거 기록 검색', () => { setMenu(null); onSearch(); }, false)}
              {button('날짜별 업무일지', () => { setMenu(null); onJournal(); }, false)}
              {currentFolder ? <>{button('폴더 이름 변경', () => { setEditor({ ...currentFolder }); setMenu(null); })}{button('폴더 이동', () => { setMoving(currentFolder); setMenu(null); })}</> : null}
              <Text style={styles.help}>음성으로 폴더 이름을 말하면 자동 분류합니다. 이름이 없거나 모호하면 미분류에 저장합니다. 폴더 숫자는 하위 폴더를 포함한 남은 할 일 수입니다.</Text>
            </> : menu ? <>
              <Text accessibilityRole="header" style={styles.title}>{menu.title}</Text>
              {button('폴더 이동', () => { setMoving(menu); setMenu(null); })}
              {section === 'tasks' && onReview ? button('다시 확인 날짜', () => { const record = menu; setMenu(null); onReview(record); }) : null}
              {section !== 'completed' ? button('알림 설정', () => { const record = menu; setMenu(null); onReminder(record); }) : null}
              {button('삭제', () => { const record = menu; setMenu(null); onDelete(record); })}
            </> : null}
            {busy ? <Text accessibilityLiveRegion="polite" style={styles.help}>저장 확인 중…</Text> : null}
            {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
            {button(editor ? '편집 취소' : moving ? '이동 취소' : '닫기', closeDialog, busy)}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal> : null}
  </View>;
}
const styles = StyleSheet.create({
  card: workspaceStyles.card, heading: workspaceStyles.heading, refresh: workspaceStyles.refresh,
  link: workspaceStyles.link, title: workspaceStyles.title, text: recordRowStyles.taskTitle, help: recordRowStyles.taskMeta,
  body: { ...recordRowStyles.taskMeta, color: mobileTheme.colors.text }, empty: { ...workspaceStyles.empty, paddingVertical: 20 },
  actions: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  folders: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  folder: { minHeight: 44, width: '48%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 4, padding: 8, borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: 12 },
  folderName: { ...recordRowStyles.taskMeta, color: mobileTheme.colors.text, flex: 1, fontWeight: '600' },
  count: { ...recordRowStyles.taskMeta, fontWeight: '700', fontVariant: ['tabular-nums'] },
  scopeLabel: { ...recordRowStyles.taskMeta, paddingTop: 6 },
  tabs: { flexDirection: 'row', gap: 6, paddingBottom: 6 },
  tab: { ...workspaceStyles.filter, flex: 1, alignItems: 'center', paddingHorizontal: 2 },
  tabText: { ...recordRowStyles.taskMeta, color: mobileTheme.colors.text, fontWeight: '700' },
  active: workspaceStyles.filterActive, selectedText: { color: mobileTheme.colors.link },
  button: { minHeight: mobileTheme.size.touchTarget, justifyContent: 'center', padding: 12, borderRadius: mobileTheme.radius.control, backgroundColor: mobileTheme.colors.surface, borderWidth: 1, borderColor: mobileTheme.colors.border },
  buttonText: { color: mobileTheme.colors.link, fontSize: 14, fontWeight: '700' }, disabled: { opacity: 0.5 },
  menuButton: { minWidth: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  editorOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }, editorScroll: { flex: 1 },
  editorContent: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  editorDialog: { width: '100%', maxWidth: 460, alignSelf: 'center', padding: 20, gap: 12, borderRadius: 16, backgroundColor: mobileTheme.colors.surface },
  input: { minHeight: 48, padding: 12, borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: 12, color: mobileTheme.colors.text },
  record: { gap: 8, paddingVertical: 10, borderTopWidth: 1, borderTopColor: mobileTheme.colors.borderSubtle },
  recordLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 }, recordActions: { gap: 6 },
  open: { flex: 1, minHeight: 48, gap: 4, justifyContent: 'center' },
  error: { color: mobileTheme.colors.danger, lineHeight: 22 },
});
