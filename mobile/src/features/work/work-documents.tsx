import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { randomUUID } from 'expo-crypto';
import { getDocumentAsync } from 'expo-document-picker';
import { File } from 'expo-file-system';
import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import { mobileTheme } from '@/src/ui/theme';
import { folderPath, type WorkFolder, type WorkScope } from './work-folders-store';
import { documentSections } from './work-document-markdown';
import { DOCUMENT_MAX_BYTES, listDocuments, readDocument, saveDocument, type DocumentSummary, type WorkDocument } from './work-documents-store';

type Props = { client: PlatformSupabaseClient; owner: string; scope: WorkScope; folders: WorkFolder[]; revision: string };
type Page = { rows: DocumentSummary[]; more: boolean };
type Opened = { mode: 'loading'; id: string } | { mode: 'read' | 'edit'; document: WorkDocument };
const emptyPage: Page = { rows: [], more: false };

function Action({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} style={styles.action}>
    <Text style={[styles.link, disabled && styles.disabled]}>{label}</Text>
  </Pressable>;
}

export function WorkDocuments({ client, owner, scope, folders, revision }: Props) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(emptyPage);
  const [listError, setListError] = useState('');
  const [pending, setPending] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [pageError, setPageError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [chooseFolder, setChooseFolder] = useState(false);
  const life = useRef(true);
  const listRun = useRef(0);
  const openRun = useRef(0);
  const locked = useRef(false);
  const listLock = useRef(false);
  const reader = useRef<ScrollView>(null);
  const headings = useRef<Record<number, number>>({});
  const viewingBody = opened?.mode === 'read' ? opened.document.body : '';
  const sections = useMemo(() => documentSections(viewingBody), [viewingBody]);

  useEffect(() => {
    life.current = true;
    return () => { life.current = false; listRun.current++; openRun.current++; };
  }, []);

  useEffect(() => {
    const request = ++listRun.current;
    setPending(true);
    setPage(emptyPage);
    setListError('');
    void listDocuments(client, owner, scope, search, 0)
      .then(result => { if (request === listRun.current) setPage(result); })
      .catch(error => { if (request === listRun.current) setListError(message(error)); })
      .finally(() => { if (request === listRun.current) setPending(false); });
    return () => { listRun.current++; };
  }, [client, owner, scope, search, revision, refresh]);

  async function more() {
    if (listLock.current || pending || !page.more) return;
    listLock.current = true;
    setPending(true);
    setListError('');
    const request = listRun.current;
    try {
      const next = await listDocuments(client, owner, scope, search, page.rows.length);
      if (request === listRun.current) setPage({ rows: [...page.rows, ...next.rows], more: next.more });
    } catch (error) {
      if (request === listRun.current) setListError(message(error));
    } finally {
      listLock.current = false;
      if (request === listRun.current) setPending(false);
    }
  }

  async function open(id: string) {
    const request = ++openRun.current;
    headings.current = {};
    setPageError('');
    setOpened({ mode: 'loading', id });
    try {
      const document = await readDocument(client, owner, id);
      if (request === openRun.current) setOpened({ mode: 'read', document });
    } catch (error) {
      if (request === openRun.current) setPageError(message(error));
    }
  }

  function create() {
    setPageError('');
    setDirty(false);
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

  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setPageError('');
    try { await action(); }
    catch (error) { if (life.current) setPageError(message(error)); }
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
      const saved = await saveDocument(client, owner, document);
      if (!life.current) return;
      headings.current = {};
      setDirty(false);
      setChooseFolder(false);
      setOpened({ mode: 'read', document: saved });
      setRefresh(value => value + 1);
    });
  }

  return <View style={styles.list}>
    <View style={styles.row}><Text accessibilityRole="header" style={styles.heading}>문서</Text><Action label="＋ 문서" onPress={create} /></View>
    <View style={styles.row}>
      <TextInput accessibilityLabel="문서 제목 또는 본문 검색" placeholder="제목·본문 검색" value={query} maxLength={160}
        onChangeText={setQuery} onSubmitEditing={() => setSearch(query.trim())} returnKeyType="search" style={[styles.input, styles.search]} />
      <Action label="검색" onPress={() => setSearch(query.trim())} />
      {search ? <Action label="초기화" onPress={() => { setQuery(''); setSearch(''); }} /> : null}
    </View>
    {listError ? <View><Text accessibilityLiveRegion="polite" style={styles.error}>{listError}</Text><Action label="다시 조회" onPress={() => setRefresh(value => value + 1)} /></View> : null}
    {pending && !page.rows.length ? <Text style={styles.muted}>문서를 불러오는 중…</Text> : null}
    {!pending && !listError && !page.rows.length ? <Text style={styles.muted}>{search ? '검색 결과가 없습니다.' : '저장된 문서가 없습니다.'}</Text> : null}
    {page.rows.map(row => <Pressable accessibilityRole="button" key={row.id} onPress={() => void open(row.id)} style={styles.item}>
      <Text style={styles.title}>{row.title}</Text>
      <Text numberOfLines={1} style={styles.muted}>{folderPath(folders, row.folder_id)}</Text>
      <Text numberOfLines={2} style={styles.muted}>{row.preview}</Text>
    </Pressable>)}
    {page.more ? <Action label="문서 더 보기" onPress={() => void more()} disabled={pending} /> : null}
    {opened ? <Modal animationType="slide" onRequestClose={dismiss}>
      <SafeAreaView style={styles.sheet}>
        <KeyboardAvoidingView style={styles.sheet} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.toolbar}>
            <Action label="닫기" onPress={dismiss} disabled={busy} />
            <Text accessibilityRole="header" style={styles.heading}>{opened.mode === 'edit' ? '문서 편집' : '문서'}</Text>
            {opened.mode === 'edit'
              ? <Action label={busy ? '처리 중…' : '저장'} onPress={() => void save(opened.document)} disabled={busy} />
              : opened.mode === 'read' ? <Action label="편집" onPress={() => setOpened({ mode: 'edit', document: opened.document })} /> : <View />}
          </View>
          {pageError ? <Text accessibilityLiveRegion="polite" style={[styles.error, styles.pageNotice]}>{pageError}</Text> : null}
          {opened.mode === 'loading' ? pageError
            ? <Action label="다시 열기" onPress={() => void open(opened.id)} />
            : <Text style={styles.pageNotice}>문서를 불러오는 중…</Text> : null}
          {opened.mode === 'edit' ? <ScrollView key="edit" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <TextInput accessibilityLabel="문서 제목" placeholder="제목" maxLength={160} editable={!busy} style={styles.input}
              value={opened.document.title} onChangeText={title => change(opened.document, { title })} />
            <View style={styles.row}>
              <Action label={`폴더 · ${folderPath(folders, opened.document.folder_id)}`} onPress={() => setChooseFolder(value => !value)} disabled={busy} />
              <Action label="파일 가져오기" onPress={() => void importMarkdown(opened.document)} disabled={busy} />
            </View>
            {chooseFolder ? <View style={styles.folderChoices}>
              {[{ id: null, name: '미분류' }, ...folders].map(folder => <Action key={folder.id ?? 'none'}
                label={folder.id ? folderPath(folders, folder.id) : folder.name} disabled={busy}
                onPress={() => { change(opened.document, { folder_id: folder.id }); setChooseFolder(false); }} />)}
            </View> : null}
            <TextInput accessibilityLabel="문서 본문" placeholder="본문을 작성하거나 붙여넣으세요" multiline editable={!busy} textAlignVertical="top"
              style={[styles.input, styles.editor]} value={opened.document.body} onChangeText={body => change(opened.document, { body })} />
            <Text style={styles.muted}>Markdown 소제목은 문서의 목차에 표시됩니다.</Text>
          </ScrollView> : null}
          {opened.mode === 'read' ? <ScrollView key="read" ref={reader} contentContainerStyle={styles.content}>
            <Text selectable style={styles.documentTitle}>{opened.document.title}</Text>
            <Text style={styles.muted}>{folderPath(folders, opened.document.folder_id)}</Text>
            {sections.some(section => section.heading) ? <View style={styles.toc}>
              <Text accessibilityRole="header" style={styles.heading}>목차</Text>
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
  heading: { fontSize: 16, fontWeight: '700', color: mobileTheme.colors.text },
  title: { fontSize: 15, fontWeight: '700', color: mobileTheme.colors.text },
  link: { color: mobileTheme.colors.link, fontWeight: '600' },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  disabled: { opacity: 0.5 },
  item: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: mobileTheme.colors.border, paddingVertical: 10, gap: 3, minHeight: 48 },
  muted: { color: mobileTheme.colors.textSecondary, lineHeight: 20 },
  error: { color: mobileTheme.colors.danger },
  sheet: { flex: 1, backgroundColor: mobileTheme.colors.surface },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: mobileTheme.colors.border },
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
