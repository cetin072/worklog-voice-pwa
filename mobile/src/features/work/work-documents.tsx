import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { randomUUID } from 'expo-crypto';
import { getDocumentAsync } from 'expo-document-picker';
import { File } from 'expo-file-system';
import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import { mobileTheme } from '@/src/ui/theme';
import { folderPath, type FolderRecord, type WorkFolder, type WorkOverview, type WorkScope } from './work-folders-store';
import { documentSections } from './work-document-markdown';
import { DOCUMENT_MAX_BYTES, DOCUMENT_PAGE_SIZE, listDocuments, listWorkMemos, readDocument, saveDocument, setDocumentDeleted, type DocumentSummary, type MemoSummary, type WorkDocument } from './work-documents-store';

type Props = {
  client: PlatformSupabaseClient; owner: string; scope: WorkScope; folders: WorkFolder[]; revision: string;
  notes: WorkOverview | null; busy: boolean;
  onEditNote: (record: FolderRecord) => void;
  onMoveNote: (record: FolderRecord) => void;
  onDeleteNote: (record: FolderRecord) => void;
  onConvertNote: (record: FolderRecord) => void;
  onReminderNote: (record: FolderRecord) => void;
  onAddDocumentTask: (document: WorkDocument) => Promise<void>;
};
type MemoRow = { kind: 'document'; value: DocumentSummary } | { kind: 'note'; value: MemoSummary };
type Page = { rows: DocumentSummary[]; more: boolean; offset: number };
type OpenMode = 'read' | 'edit' | 'move' | 'delete' | 'task';
type Opened = { mode: 'loading'; id: string; destination: OpenMode }
  | { mode: 'read' | 'edit' | 'move' | 'task'; document: WorkDocument }
  | { mode: 'note'; note: MemoSummary }
  | { mode: 'delete'; document: WorkDocument };
type DeletedDocument = Pick<WorkDocument, 'id' | 'title' | 'version'>;
const emptyPage: Page = { rows: [], more: false, offset: 0 };

function Action({ label, onPress, disabled = false, accessibilityLabel, danger = false }: {
  label: string; onPress: () => void; disabled?: boolean; accessibilityLabel?: string; danger?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} disabled={disabled}
    style={[styles.action, disabled && styles.disabled]}>
    <Text style={[styles.link, danger && styles.danger]}>{label}</Text>
  </Pressable>;
}

export function WorkDocuments({ client, owner, scope, folders, revision, notes, busy: parentBusy,
  onEditNote, onMoveNote, onDeleteNote, onConvertNote, onReminderNote, onAddDocumentTask }: Props) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(emptyPage);
  const [memoRows, setMemoRows] = useState<MemoSummary[]>([]);
  const [memoPending, setMemoPending] = useState(true);
  const [memoError, setMemoError] = useState('');
  const [visible, setVisible] = useState(DOCUMENT_PAGE_SIZE);
  const [menu, setMenu] = useState<MemoRow | null>(null);
  const [listError, setListError] = useState('');
  const [pending, setPending] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [pageError, setPageError] = useState('');
  const [undo, setUndo] = useState<DeletedDocument | null>(null);
  const [undoError, setUndoError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [chooseFolder, setChooseFolder] = useState(false);
  const [showTitle, setShowTitle] = useState(false);
  const [showContents, setShowContents] = useState(false);
  const [notice, setNotice] = useState('');
  const life = useRef(true);
  const listRun = useRef(0);
  const openRun = useRef(0);
  const locked = useRef(false);
  const listLock = useRef(false);
  const reader = useRef<ScrollView>(null);
  const headings = useRef<Record<number, number>>({});
  const viewingBody = opened?.mode === 'read' ? opened.document.body : '';
  const sections = useMemo(() => documentSections(viewingBody), [viewingBody]);
  const rows = useMemo(() => {
    const term = search.toLowerCase();
    const cutoff = page.more ? Date.parse(page.rows.at(-1)?.updated_at ?? '') : -Infinity;
    const result: MemoRow[] = page.rows.map(value => ({ kind: 'document', value }));
    for (const value of memoRows) {
      const timestamp = Date.parse(value.updated_at) || 0;
      if (timestamp >= cutoff && (!term || [value.title, value.content, value.original_text]
        .some(field => field?.toLowerCase().includes(term)))) result.push({ kind: 'note', value });
    }
    return result.sort((a, b) => (Date.parse(b.value.updated_at) || 0) - (Date.parse(a.value.updated_at) || 0)
      || (a.kind === b.kind ? a.value.id.localeCompare(b.value.id) : a.kind === 'document' ? -1 : 1));
  }, [memoRows, page, search]);

  useEffect(() => {
    life.current = true;
    return () => { life.current = false; listRun.current++; openRun.current++; };
  }, []);

  useEffect(() => {
    const request = ++listRun.current;
    setPending(true);
    setListError('');
    void listDocuments(client, owner, scope, search, 0)
      .then(result => { if (request === listRun.current) setPage({ ...result, offset: result.rows.length }); })
      .catch(error => { if (request === listRun.current) setListError(message(error)); })
      .finally(() => { if (request === listRun.current) setPending(false); });
    return () => { listRun.current++; };
  }, [client, owner, scope, search, revision, refresh]);

  useEffect(() => {
    if (!notes) return;
    let current = true;
    setMemoPending(true);
    setMemoError('');
    void listWorkMemos(client, owner, scope, notes, () => current)
      .then(result => { if (current) setMemoRows(result); })
      .catch(error => { if (current) setMemoError(message(error)); })
      .finally(() => { if (current) setMemoPending(false); });
    return () => { current = false; };
  }, [client, owner, scope, notes, refresh]);

  function submitSearch(value: string) {
    const next = value.trim();
    if (next === search) return;
    listRun.current++;
    setVisible(DOCUMENT_PAGE_SIZE);
    setPage(emptyPage);
    setPending(true);
    setSearch(next);
  }

  async function more() {
    if (rows.length >= visible + DOCUMENT_PAGE_SIZE || !page.more) {
      setVisible(value => value + DOCUMENT_PAGE_SIZE);
      return;
    }
    if (listLock.current || pending || !page.more) return;
    listLock.current = true;
    setPending(true);
    setListError('');
    const request = listRun.current;
    try {
      const next = await listDocuments(client, owner, scope, search, page.offset);
      if (request === listRun.current) {
        const rows = [...new Map([...page.rows, ...next.rows].map(row => [row.id, row])).values()];
        setPage({ rows, more: next.more, offset: page.offset + next.rows.length });
        setVisible(value => value + DOCUMENT_PAGE_SIZE);
      }
    } catch (error) {
      if (request === listRun.current) setListError(message(error));
    } finally {
      listLock.current = false;
      if (request === listRun.current) setPending(false);
    }
  }

  async function open(id: string, destination: OpenMode = 'read') {
    const request = ++openRun.current;
    headings.current = {};
    setChooseFolder(false);
    setShowTitle(destination === 'edit');
    setShowContents(false);
    setPageError('');
    setOpened({ mode: 'loading', id, destination });
    try {
      const document = await readDocument(client, owner, id);
      if (request === openRun.current) setOpened({ mode: destination, document });
    } catch (error) {
      if (request === openRun.current) setPageError(message(error));
    }
  }

  function create() {
    setPageError('');
    setDirty(false);
    setShowTitle(false);
    setOpened({ mode: 'edit', document: { id: randomUUID(), title: '', body: '', version: -1, folder_id: scope === 'all' ? null : scope } });
  }

  function change(document: WorkDocument, changes: Partial<WorkDocument>) {
    setDirty(true);
    setOpened({ mode: 'edit', document: { ...document, ...changes } });
  }

  function dismiss() {
    if (locked.current) return;
    const close = () => {
      openRun.current++;
      setOpened(null);
      setChooseFolder(false);
      setPageError('');
      setDirty(false);
    };
    if (dirty) Alert.alert('저장하지 않은 변경', '편집 내용을 버리고 닫을까요?', [
      { text: '계속 편집', style: 'cancel' }, { text: '닫기', style: 'destructive', onPress: close },
    ]);
    else close();
  }

  async function run(action: () => Promise<void>, setError = setPageError) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try { await action(); }
    catch (error) { if (life.current) setError(message(error)); }
    finally {
      locked.current = false;
      if (life.current) setBusy(false);
    }
  }

  async function importMarkdown(document: WorkDocument) {
    if (document.body.trim()) {
      Alert.alert('본문을 바꿀까요?', '파일을 선택하면 현재 편집 중인 본문이 파일 내용으로 바뀝니다.', [
        { text: '취소', style: 'cancel' }, { text: '파일 선택', onPress: () => void pickMarkdown(document) },
      ]);
    } else await pickMarkdown(document);
  }

  async function pickMarkdown(document: WorkDocument) {
    await run(async () => {
      // Android providers may label .md as application/octet-stream.
      const result = await getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (result.canceled || !life.current) return;
      const asset = result.assets[0];
      if (!asset || !/\.(md|markdown|txt)$/i.test(asset.name)) throw new Error('Markdown(.md) 또는 텍스트(.txt) 파일을 선택해주세요.');
      const file = new File(asset.uri);
      if ((asset.size ?? file.size ?? 0) > DOCUMENT_MAX_BYTES) throw new Error('1MB 이하의 파일을 선택해주세요.');
      const body = (await file.text()).replace(/^\uFEFF/, '');
      if (!body.trim() || body.includes('\0')) throw new Error('내용이 있는 UTF-8 텍스트 파일을 선택해주세요.');
      if (life.current) change(document, { body, title: document.title || asset.name.replace(/\.[^.]+$/, '').slice(0, 160) });
    });
  }

  async function save(document: WorkDocument) {
    await run(async () => {
      const title = document.title.trim() || Array.from(document.body.trimStart().split(/\r?\n/, 1)[0]
        .replace(/^#{1,6}\s+/, '').trim() || '메모').slice(0, 160).join('');
      const saved = await saveDocument(client, owner, { ...document, title });
      if (!life.current) return;
      headings.current = {};
      setDirty(false);
      setChooseFolder(false);
      setOpened({ mode: 'read', document: saved });
      setRefresh(value => value + 1);
    });
  }

  async function remove(document: WorkDocument) {
    await run(async () => {
      const version = await setDocumentDeleted(client, owner, document, true);
      if (!life.current) return;
      setUndo({ id: document.id, title: document.title, version });
      setUndoError('');
      listRun.current++;
      setPage(current => ({ ...current, rows: current.rows.filter(row => row.id !== document.id) }));
      setOpened(null);
      setRefresh(value => value + 1);
    });
  }

  async function restore(document: DeletedDocument) {
    await run(async () => {
      await setDocumentDeleted(client, owner, document, false);
      if (!life.current) return;
      setUndo(null);
      setRefresh(value => value + 1);
    }, setUndoError);
  }

  function noteAction(action: (record: FolderRecord) => void, record: MemoSummary) {
    setMenu(null);
    setOpened(null);
    action(record);
  }

  async function move(document: WorkDocument, folder_id: string | null) {
    await run(async () => {
      if (folder_id !== document.folder_id) await saveDocument(client, owner, { ...document, folder_id });
      if (!life.current) return;
      setOpened(null);
      setRefresh(value => value + 1);
    });
  }

  async function addTask(document: WorkDocument) {
    await run(async () => {
      await onAddDocumentTask(document);
      if (!life.current) return;
      setOpened(null);
      setNotice('할 일에 추가했습니다.');
    });
  }

  const loading = pending || memoPending || !notes;
  return <View style={styles.list}>
    <View style={styles.row}>
      <TextInput accessibilityLabel="메모·자료 검색" placeholder="제목·본문 검색" value={query} maxLength={160}
        onChangeText={setQuery} onSubmitEditing={() => submitSearch(query)} returnKeyType="search" style={[styles.input, styles.search]} />
      <Action label="검색" onPress={() => submitSearch(query)} />
      {search ? <Action label="초기화" onPress={() => { setQuery(''); submitSearch(''); }} /> : null}
    </View>
    <View style={styles.sectionHead}><Action label="＋ 새 메모" accessibilityLabel="새 메모" onPress={create} disabled={busy || parentBusy} /></View>
    {listError || memoError ? <View><Text accessibilityLiveRegion="polite" style={styles.error}>{[listError, memoError].filter(Boolean).join('\n')}</Text><Action label="다시 조회" onPress={() => setRefresh(value => value + 1)} /></View> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.muted}>{notice}</Text> : null}
    {undo ? <View style={styles.undoRow}>
      <Text style={styles.undoMessage} accessibilityLiveRegion="polite">‘{undo.title}’ 기록을 삭제했습니다.</Text>
      <Action label="실행 취소" accessibilityLabel={`${undo.title} 삭제 실행 취소`} disabled={busy} onPress={() => void restore(undo)} />
      {undoError ? <Text accessibilityLiveRegion="polite" style={[styles.error, styles.undoError]}>{undoError}</Text> : null}
    </View> : null}
    {loading && !rows.length ? <Text style={styles.muted}>메모·자료를 불러오는 중…</Text> : null}
    {!loading && !listError && !memoError && !rows.length ? <Text style={styles.muted}>{search ? '검색 결과가 없습니다.' : '저장된 메모·자료가 없습니다.'}</Text> : null}
    {rows.slice(0, visible).map(row => {
      const value = row.value;
      const preview = row.kind === 'document' ? row.value.preview : row.value.content || row.value.original_text;
      return <View key={`${row.kind}:${value.id}`} style={styles.item}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${value.title} 열기`} disabled={busy || parentBusy} style={styles.itemLink}
          onPress={() => {
            if (row.kind === 'document') void open(value.id);
            else { setPageError(''); setOpened({ mode: 'note', note: row.value }); }
          }}>
          <Text numberOfLines={2} style={styles.title}>{value.title}</Text>
          {preview?.trim() && preview.trim() !== value.title.trim() ? <Text numberOfLines={2} style={styles.muted}>{preview}</Text> : null}
          {value.folder_id ? <Text numberOfLines={1} style={styles.folderCaption}>{folderPath(folders, value.folder_id)}</Text> : null}
        </Pressable>
        <Action label="⋯" accessibilityLabel={`${value.title} 메뉴`} disabled={busy || parentBusy} onPress={() => setMenu(row)} />
      </View>;
    })}
    {page.more || rows.length > visible ? <Action label="더 보기" onPress={() => void more()} disabled={loading} /> : null}
    {menu ? <Modal transparent animationType="fade" onRequestClose={() => setMenu(null)}>
      <View style={styles.menuOverlay}><View style={styles.menuDialog} accessibilityViewIsModal>
        <Text accessibilityRole="header" style={styles.heading}>{menu.value.title}</Text>
        {menu.kind === 'document' ? ([
          ['편집', 'edit'], ['폴더 이동', 'move'], ['할 일로 추가', 'task'], ['삭제', 'delete'],
        ] as const).map(([label, destination]) => <Action key={destination} label={label} onPress={() => { setMenu(null); void open(menu.value.id, destination); }} />) : <>
          <Action label="편집" onPress={() => noteAction(onEditNote, menu.value)} />
          <Action label="폴더 이동" onPress={() => noteAction(onMoveNote, menu.value)} />
          <Action label="할 일로 전환" onPress={() => noteAction(onConvertNote, menu.value)} />
          <Action label="알림 설정" onPress={() => noteAction(onReminderNote, menu.value)} />
          <Action label="삭제" danger onPress={() => noteAction(onDeleteNote, menu.value)} />
        </>}
        <Action label="닫기" onPress={() => setMenu(null)} />
      </View></View>
    </Modal> : null}
    {opened ? <Modal animationType="slide" onRequestClose={dismiss}>
      <SafeAreaView style={styles.sheet}>
        <KeyboardAvoidingView style={styles.sheet} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.toolbar}>
            <Action label={opened.mode === 'delete' ? '취소' : '닫기'} onPress={dismiss} disabled={busy} />
            <Text accessibilityRole="header" style={[styles.heading, styles.toolbarTitle]}>{opened.mode === 'edit' ? (opened.document.version < 0 ? '새 메모' : '편집')
              : opened.mode === 'delete' ? '삭제' : opened.mode === 'move' ? '폴더 이동'
              : opened.mode === 'task' ? '할 일로 추가' : '메모·자료'}</Text>
            {opened.mode === 'edit'
              ? <Action label={busy ? '처리 중…' : '저장'} onPress={() => void save(opened.document)} disabled={busy} />
              : opened.mode === 'read' ? <View style={styles.row}>
                <Action label="편집" onPress={() => { setShowTitle(true); setOpened({ mode: 'edit', document: opened.document }); }} />
              </View> : null}
          </View>
          {pageError ? <Text accessibilityLiveRegion="polite" style={[styles.error, styles.pageNotice]}>{pageError}</Text> : null}
          {opened.mode === 'loading' ? pageError
            ? <Action label="다시 열기" onPress={() => void open(opened.id, opened.destination)} />
            : <Text style={styles.pageNotice}>기록을 불러오는 중…</Text> : null}
          {opened.mode === 'delete' ? <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.documentTitle}>{opened.document.title}</Text>
            <Text style={styles.body}>이 기록을 삭제할까요? 목록에서 바로 실행 취소할 수 있습니다.</Text>
            <View style={styles.row}><Action label={busy ? '삭제 중…' : '삭제 확인'} danger onPress={() => void remove(opened.document)} disabled={busy} /></View>
          </ScrollView> : null}
          {opened.mode === 'move' ? <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.heading}>{opened.document.title}</Text>
            {[{ id: null, name: '미분류' }, ...folders].map(folder => <Action key={folder.id ?? 'none'}
              label={folder.id ? folderPath(folders, folder.id) : folder.name} disabled={busy}
              onPress={() => void move(opened.document, folder.id)} />)}
          </ScrollView> : null}
          {opened.mode === 'task' ? <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.heading}>{opened.document.title}</Text>
            <Text style={styles.body}>이 제목으로 할 일을 추가합니다. 본문은 메모·자료에서 볼 수 있습니다.</Text>
            <Action label={busy ? '추가 중…' : '할 일 추가'} onPress={() => void addTask(opened.document)} disabled={busy} />
          </ScrollView> : null}
          {opened.mode === 'note' ? <ScrollView contentContainerStyle={styles.content}>
            <Text selectable style={styles.documentTitle}>{opened.note.title}</Text>
            <Text style={styles.muted}>{folderPath(folders, opened.note.folder_id)}</Text>
            {opened.note.content || opened.note.original_text ? <Text selectable style={styles.body}>{opened.note.content || opened.note.original_text}</Text> : null}
          </ScrollView> : null}
          {opened.mode === 'edit' ? <ScrollView key="edit" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <TextInput accessibilityLabel="메모 본문" placeholder="내용을 적어주세요" multiline editable={!busy} textAlignVertical="top"
              style={[styles.input, styles.editor]} value={opened.document.body} onChangeText={body => change(opened.document, { body })} />
            <View style={styles.row}>
              {!showTitle ? <Action label="제목 추가" onPress={() => setShowTitle(true)} disabled={busy} /> : null}
              <Action label={`폴더 · ${folderPath(folders, opened.document.folder_id)}`} onPress={() => setChooseFolder(value => !value)} disabled={busy} />
              <Action label="파일 가져오기" onPress={() => void importMarkdown(opened.document)} disabled={busy} />
            </View>
            {showTitle || opened.document.title ? <TextInput accessibilityLabel="메모 제목" placeholder="제목 (선택)" maxLength={160} editable={!busy} style={styles.input}
              value={opened.document.title} onChangeText={title => change(opened.document, { title })} /> : null}
            {chooseFolder ? <View style={styles.folderChoices}>
              {[{ id: null, name: '미분류' }, ...folders].map(folder => <Action key={folder.id ?? 'none'}
                label={folder.id ? folderPath(folders, folder.id) : folder.name} disabled={busy}
                onPress={() => { change(opened.document, { folder_id: folder.id }); setChooseFolder(false); }} />)}
            </View> : null}
          </ScrollView> : null}
          {opened.mode === 'read' ? <ScrollView key="read" ref={reader} contentContainerStyle={styles.content}>
            <Text selectable style={styles.documentTitle}>{opened.document.title}</Text>
            <Text style={styles.muted}>{folderPath(folders, opened.document.folder_id)}</Text>
            {sections.some(section => section.heading) ? <Action label={showContents ? '목차 닫기' : '목차 보기'} onPress={() => setShowContents(value => !value)} /> : null}
            {showContents && sections.some(section => section.heading) ? <View style={styles.toc}>
              {sections.map((section, index) => section.heading ? <Pressable key={index} accessibilityRole="button"
                style={[styles.action, { paddingLeft: Math.min((section.level ?? 1) - 1, 3) * 12 }]}
                onPress={() => { const y = headings.current[index]; if (y !== undefined) reader.current?.scrollTo({ y, animated: true }); }}>
                <Text style={styles.link}>{section.heading}</Text>
              </Pressable> : null)}
            </View> : null}
            {sections.map((section, index) => <View key={index} onLayout={event => { headings.current[index] = event.nativeEvent.layout.y; }}>
              {section.heading ? <Text selectable accessibilityRole="header" style={section.level && section.level > 2 ? styles.heading : styles.sectionTitle}>{section.heading}</Text> : null}
              {section.body ? <Text selectable style={styles.body}>{section.body}</Text> : null}
            </View>)}
          </ScrollView> : null}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal> : null}
  </View>;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : '문서를 처리하지 못했습니다.';
}

const styles = StyleSheet.create({
  list: { gap: 8, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  heading: { fontSize: 16, fontWeight: '700', color: mobileTheme.colors.text },
  title: { fontSize: 15, fontWeight: '700', color: mobileTheme.colors.text },
  link: { color: mobileTheme.colors.link, fontWeight: '600' },
  action: { minHeight: 48, minWidth: 48, flexShrink: 1, justifyContent: 'center', paddingHorizontal: 8 },
  danger: { color: mobileTheme.colors.danger },
  disabled: { opacity: 0.5 },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: mobileTheme.colors.border, paddingVertical: 8 },
  itemLink: { flex: 1, minWidth: 0, minHeight: 48, gap: 3, justifyContent: 'center' },
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 22 },
  menuDialog: { width: '100%', maxWidth: 460, alignSelf: 'center', padding: 16, borderRadius: 12, backgroundColor: mobileTheme.colors.surface },
  undoRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: mobileTheme.colors.upcomingBackground },
  undoMessage: { flex: 1, minWidth: 90, color: mobileTheme.colors.text },
  undoError: { width: '100%' },
  folderCaption: { fontSize: 13, color: mobileTheme.colors.textMuted },
  muted: { color: mobileTheme.colors.textSecondary, lineHeight: 20 },
  error: { color: mobileTheme.colors.danger },
  sheet: { flex: 1, backgroundColor: mobileTheme.colors.surface },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingHorizontal: 14, minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: mobileTheme.colors.border },
  toolbarTitle: { flexGrow: 1, flexShrink: 1 },
  pageNotice: { padding: 16 },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  input: { borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: 10, padding: 10, color: mobileTheme.colors.text, minHeight: 44 },
  search: { flex: 1, minWidth: 110 },
  editor: { minHeight: 280, fontSize: 16, lineHeight: 24 },
  folderChoices: { borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: 10 },
  toc: { padding: 12, backgroundColor: mobileTheme.colors.neutralBackground, borderRadius: 12 },
  documentTitle: { fontSize: 26, fontWeight: '800', color: mobileTheme.colors.text },
  sectionTitle: { fontSize: 20, fontWeight: '700', color: mobileTheme.colors.text },
  body: { color: mobileTheme.colors.text, fontSize: 16, lineHeight: 25, marginTop: 4 },
});
