import { useState } from 'react';
import { ActivityIndicator, Button, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { readWorklogDetails, searchMyWorkRecords, updateWorklogDetails, type WorkRecordSearchResult } from '@/src/platform/worklog-api';
import type { PlatformSupabaseClient } from '@/src/platform/supabase';

const STATUS_FILTERS = [
  { value: 'in_progress', label: '진행중' },
  { value: 'waiting', label: '대기' },
  { value: 'needs_review', label: '확인필요' },
  { value: 'completed', label: '완료' },
] as const;

function statusLabel(status: string) {
  return STATUS_FILTERS.find((filter) => filter.value === status)?.label || status || '상태 미정';
}

function recordedAtLabel(value?: string) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', year: 'numeric' }).format(new Date(value));
  } catch {
    return '';
  }
}

export function WorkRecordSearch({ client, accessToken }: { client: PlatformSupabaseClient; accessToken: string }) {
  const [query, setQuery] = useState('');
  const [statuses, setStatuses] = useState<string[]>([]);
  const [items, setItems] = useState<WorkRecordSearchResult[]>([]);
  const [nextOffset, setNextOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  async function search(reset: boolean) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery || busy) {
      if (!normalizedQuery) setMessage('검색어를 입력해 주세요.');
      return;
    }

    setBusy(true);
    setMessage('');
    try {
      const page = await searchMyWorkRecords(client, normalizedQuery, reset ? 0 : nextOffset, statuses);
      setItems((current) => reset ? page.items : [...current, ...page.items]);
      setNextOffset(page.nextOffset);
      setHasMore(page.hasMore);
      if (page.items.length === 0) setMessage(page.hasMore ? '이 조건의 결과가 다음 페이지에 있을 수 있습니다. 더 보기를 눌러 계속 검색하세요.' : '검색 결과가 없습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '과거 업무 검색에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  function toggleStatus(status: string) {
    setStatuses((current) => current.includes(status) ? current.filter((value) => value !== status) : [...current, status]);
    setItems([]);
    setNextOffset(0);
    setHasMore(false);
    setMessage('상태 조건을 바꿨습니다. 검색을 다시 눌러 적용하세요.');
  }

  async function openEditor(item: WorkRecordSearchResult) {
    if (editBusy) return;
    setSelectedId(item.workRecordId);
    setEditId(item.workRecordId);
    setEditTitle(item.title);
    setEditDate('');
    setEditTime('');
    setEditBusy(true);
    setMessage('');
    try {
      const details = await readWorklogDetails(accessToken, item.workRecordId);
      setEditTitle(details.title || item.title);
      setEditDate(details.dueDate || '');
      setEditTime(details.dueTime || '');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '업무 상세를 불러오지 못했습니다.');
      setEditId(null);
    } finally {
      setEditBusy(false);
    }
  }

  async function saveEditor() {
    if (!editId || editBusy) return;
    const title = editTitle.replace(/\s+/g, ' ').trim();
    if (!title) {
      setMessage('업무명을 입력해주세요.');
      return;
    }
    if (editTime.trim() && !editDate.trim()) {
      setMessage('시간을 설정하려면 날짜도 입력해주세요.');
      return;
    }

    setEditBusy(true);
    setMessage('');
    try {
      await updateWorklogDetails(accessToken, {
        pageId: editId,
        title,
        dueDate: editDate.trim(),
        dueTime: editTime.trim(),
      });
      setEditId(null);
      await search(true);
      setMessage('업무를 수정했습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '업무 수정에 실패했습니다.');
    } finally {
      setEditBusy(false);
    }
  }

  function cancelEditor() {
    if (editBusy) return;
    setEditId(null);
    setEditTitle('');
    setEditDate('');
    setEditTime('');
  }

  return <View style={styles.root}>
    <Text style={styles.help}>현재 업무뿐 아니라 과거·완료 업무의 업무명, 기관, 후속조치, 원문까지 검색합니다.</Text>
    <TextInput accessibilityLabel="전체 업무 검색" placeholder="예: 계약서, 태장, 회신 확인" style={styles.input} value={query} onChangeText={setQuery} returnKeyType="search" onSubmitEditing={() => void search(true)} />
    <View style={styles.filters}>{STATUS_FILTERS.map((filter) => <Pressable key={filter.value} accessibilityRole="button" accessibilityLabel={`${filter.label} 상태 ${statuses.includes(filter.value) ? '해제' : '선택'}`} style={[styles.filter, statuses.includes(filter.value) ? styles.filterActive : null]} disabled={busy} onPress={() => toggleStatus(filter.value)}><Text style={[styles.filterText, statuses.includes(filter.value) ? styles.filterTextActive : null]}>{statuses.includes(filter.value) ? '✓ ' : ''}{filter.label}</Text></Pressable>)}</View>
    <Button title={busy ? '전체 기록 검색 중...' : '전체 기록 검색'} disabled={busy || !query.trim()} onPress={() => void search(true)} />
    {busy ? <View style={styles.loading}><ActivityIndicator /><Text style={styles.meta}>검색 중입니다.</Text></View> : null}
    {items.map((item) => {
      const selected = item.workRecordId === selectedId;
      const editing = item.workRecordId === editId;
      return <View key={item.workRecordId} style={styles.result}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${item.title} ${selected ? '접기' : '상세 보기'}`} style={styles.resultMain} onPress={() => setSelectedId((current) => current === item.workRecordId ? null : item.workRecordId)}>
          <View style={styles.resultCopy}><Text style={styles.title}>{item.title}</Text><Text style={styles.meta}>{statusLabel(item.status)}{item.institution ? ` · ${item.institution}` : ''}{recordedAtLabel(item.recordedAt) ? ` · ${recordedAtLabel(item.recordedAt)}` : ''}</Text>{item.snippet ? <Text style={styles.snippet}>{item.snippet}</Text> : null}</View>
          <Text style={styles.expand}>{selected ? '접기' : '상세'}</Text>
        </Pressable>
        {selected ? <View style={styles.detail}>
          {item.dueAt ? <Text style={styles.detailMeta}>기한: {recordedAtLabel(item.dueAt)}</Text> : <Text style={styles.detailMeta}>기한 없음</Text>}
          {!editing ? <Pressable accessibilityRole="button" style={styles.editAction} disabled={editBusy} onPress={() => void openEditor(item)}><Text style={styles.editActionText}>{editBusy && selectedId === item.workRecordId ? '불러오는 중…' : '✏️ 이 업무 수정'}</Text></Pressable> : null}
          {editing ? <View style={styles.editor}>
            <TextInput accessibilityLabel="검색 결과 업무명 수정" placeholder="업무명" style={styles.input} value={editTitle} onChangeText={setEditTitle} />
            <View style={styles.dateRow}><View style={styles.field}><Text style={styles.fieldLabel}>날짜</Text><TextInput accessibilityLabel="검색 결과 날짜 수정" placeholder="YYYY-MM-DD" style={styles.input} value={editDate} onChangeText={setEditDate} /></View><View style={styles.field}><Text style={styles.fieldLabel}>시간</Text><TextInput accessibilityLabel="검색 결과 시간 수정" placeholder="HH:MM" style={styles.input} value={editTime} onChangeText={setEditTime} /></View></View>
            {!editDate && !editTime ? <Text style={styles.detailMeta}>현재 기한 없음</Text> : null}
            <View style={styles.editorActions}><Pressable accessibilityRole="button" style={styles.secondaryAction} disabled={editBusy} onPress={cancelEditor}><Text style={styles.secondaryText}>취소</Text></Pressable><Pressable accessibilityRole="button" style={styles.primaryAction} disabled={editBusy || !editTitle.trim()} onPress={() => void saveEditor()}><Text style={styles.primaryText}>{editBusy ? '저장 중…' : '저장'}</Text></Pressable></View>
          </View> : null}
        </View> : null}
      </View>;
    })}
    {hasMore ? <Button title={busy ? '더 불러오는 중...' : '더 보기'} disabled={busy} onPress={() => void search(false)} /> : null}
    {message ? <Text style={styles.message}>{message}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  help: { fontSize: 14, color: '#4b515c', lineHeight: 21 },
  input: { borderWidth: 1, borderColor: '#d7dae0', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, backgroundColor: '#fff' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filter: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 11, borderWidth: 1, borderColor: '#cfd5dd', borderRadius: 12, backgroundColor: '#fff' },
  filterActive: { borderColor: '#275daf', backgroundColor: '#edf4ff' },
  filterText: { fontSize: 13, fontWeight: '700', color: '#30343b' },
  filterTextActive: { color: '#275daf' },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  result: { gap: 8, borderTopWidth: 1, borderTopColor: '#eceef1', paddingTop: 13 },
  resultMain: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  resultCopy: { flex: 1, minWidth: 0, gap: 4 },
  expand: { fontSize: 12, fontWeight: '800', color: '#275daf', paddingVertical: 4 },
  detail: { gap: 8, padding: 10, borderRadius: 10, backgroundColor: '#f8fafc' },
  detailMeta: { fontSize: 12, color: '#737985', lineHeight: 18 },
  editAction: { minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#cfd5dd', backgroundColor: '#fff' },
  editActionText: { fontSize: 13, fontWeight: '800', color: '#275daf' },
  editor: { gap: 8 },
  dateRow: { flexDirection: 'row', gap: 8 },
  dateInput: { flex: 1 },
  field: { flex: 1, gap: 6 },
  fieldLabel: { fontSize: 12, fontWeight: '800', color: '#4b515c' },
  editorActions: { flexDirection: 'row', gap: 8 },
  secondaryAction: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#cfd5dd', backgroundColor: '#fff' },
  secondaryText: { fontSize: 13, fontWeight: '800', color: '#4b515c' },
  primaryAction: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#111827' },
  primaryText: { fontSize: 13, fontWeight: '800', color: '#fff' },
  title: { fontSize: 15, fontWeight: '800', color: '#30343b', lineHeight: 21 },
  meta: { fontSize: 12, color: '#737985', lineHeight: 18 },
  snippet: { fontSize: 13, color: '#4b515c', lineHeight: 19 },
  message: { fontSize: 13, color: '#4b515c', lineHeight: 19, backgroundColor: '#f4f7fb', padding: 10, borderRadius: 10 },
});
