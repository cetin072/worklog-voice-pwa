import { useState } from 'react';
import { ActivityIndicator, Button, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { WorkRecordEditSheet } from '@/src/features/work/work-record-edit-sheet';
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
  const [editActionKind, setEditActionKind] = useState<'task' | 'note' | undefined>(undefined);
  const [editActionConversionAllowed, setEditActionConversionAllowed] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editReady, setEditReady] = useState(false);
  const [editStatus, setEditStatus] = useState('');
  const [editStatusTone, setEditStatusTone] = useState<'neutral' | 'success' | 'error'>('neutral');

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

  async function loadEditorDetails(recordId: string, fallbackTitle = '') {
    if (editBusy || editLoading) return;
    setEditLoading(true);
    setEditReady(false);
    setEditStatus('');
    setEditStatusTone('neutral');
    try {
      const details = await readWorklogDetails(accessToken, recordId);
      setEditTitle(details.title || fallbackTitle);
      setEditDate(details.dueDate || '');
      setEditTime(details.dueTime || '');
      setEditActionKind(details.actionKind);
      setEditActionConversionAllowed(details.actionConversionAllowed === true);
      setEditReady(true);
    } catch (error) {
      setEditStatus(error instanceof Error ? error.message : '업무 상세를 불러오지 못했습니다.');
      setEditStatusTone('error');
    } finally {
      setEditLoading(false);
    }
  }

  async function openEditor(item: WorkRecordSearchResult) {
    if (editBusy || editLoading) return;
    setSelectedId(item.workRecordId);
    setEditId(item.workRecordId);
    setEditTitle(item.title);
    setEditDate('');
    setEditTime('');
    setEditActionKind(undefined);
    setEditActionConversionAllowed(false);
    setEditReady(false);
    setEditStatus('');
    setEditStatusTone('neutral');
    await loadEditorDetails(item.workRecordId, item.title);
  }

  async function retryEditor() {
    if (!editId) return;
    await loadEditorDetails(editId, editTitle);
  }

  async function saveEditor() {
    if (!editId || editBusy || editLoading || !editReady) return;
    const recordId = editId;
    const title = editTitle.replace(/\s+/g, ' ').trim();
    if (!title) {
      setEditStatus('업무명을 입력해주세요.');
      setEditStatusTone('error');
      return;
    }
    if (title.length > 160) {
      setEditStatus('업무명은 160자 이하로 입력해주세요.');
      setEditStatusTone('error');
      return;
    }
    if (editTime.trim() && !editDate.trim()) {
      setEditStatus('시간을 설정하려면 날짜도 입력해주세요.');
      setEditStatusTone('error');
      return;
    }

    setEditBusy(true);
    setEditStatus('');
    setEditStatusTone('neutral');
    try {
      const result = await updateWorklogDetails(accessToken, {
        pageId: recordId,
        title,
        dueDate: editDate.trim(),
        dueTime: editTime.trim(),
        ...(editActionConversionAllowed && editActionKind ? { actionKind: editActionKind } : {}),
      });
      const visibleTitle = result.title?.trim() || title;
      setItems((current) => current.map((item) => item.workRecordId === recordId ? { ...item, title: visibleTitle } : item));
      setEditBusy(false);
      setEditReady(false);
      setEditStatus(result.actionKindChanged
        ? result.actionKind === 'note'
          ? '✓ 메모 · 참고로 변경했습니다.'
          : '✓ 할 일로 변경했습니다.'
        : result.unchanged
          ? '변경된 내용이 없습니다.'
          : '✓ 업무를 수정했습니다.');
      setEditStatusTone(result.unchanged && !result.actionKindChanged ? 'neutral' : 'success');
      await new Promise((resolve) => setTimeout(resolve, 420));
      setEditId(null);
      setEditStatus('');
      setEditStatusTone('neutral');
      await search(true);
    } catch (error) {
      setEditStatus(error instanceof Error ? error.message : '업무 수정에 실패했습니다.');
      setEditStatusTone('error');
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
    setEditActionKind(undefined);
    setEditActionConversionAllowed(false);
    setEditReady(false);
    setEditStatus('');
    setEditStatusTone('neutral');
  }

  return <View style={styles.root}>
    <Text style={styles.help}>현재 업무뿐 아니라 과거·완료 업무의 업무명, 기관, 후속조치, 원문까지 검색합니다.</Text>
    <TextInput accessibilityLabel="전체 업무 검색" placeholder="예: 계약서, 태장, 회신 확인" style={styles.input} value={query} onChangeText={setQuery} returnKeyType="search" onSubmitEditing={() => void search(true)} />
    <View style={styles.filters}>{STATUS_FILTERS.map((filter) => <Pressable key={filter.value} accessibilityRole="button" accessibilityLabel={`${filter.label} 상태 ${statuses.includes(filter.value) ? '해제' : '선택'}`} style={[styles.filter, statuses.includes(filter.value) ? styles.filterActive : null]} disabled={busy} onPress={() => toggleStatus(filter.value)}><Text style={[styles.filterText, statuses.includes(filter.value) ? styles.filterTextActive : null]}>{statuses.includes(filter.value) ? '✓ ' : ''}{filter.label}</Text></Pressable>)}</View>
    <Button title={busy ? '전체 기록 검색 중...' : '전체 기록 검색'} disabled={busy || !query.trim()} onPress={() => void search(true)} />
    {busy ? <View style={styles.loading}><ActivityIndicator /><Text style={styles.meta}>검색 중입니다.</Text></View> : null}
    {items.map((item) => {
      const selected = item.workRecordId === selectedId;
      return <View key={item.workRecordId} style={styles.result}>
        <View style={styles.resultHeader}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${item.title} ${selected ? '접기' : '상세 보기'}`} style={styles.resultMain} onPress={() => setSelectedId((current) => current === item.workRecordId ? null : item.workRecordId)}>
            <View style={styles.resultCopy}><Text style={styles.title}>{item.title}</Text><Text style={styles.meta}>{statusLabel(item.status)}{item.institution ? ` · ${item.institution}` : ''}{recordedAtLabel(item.recordedAt) ? ` · ${recordedAtLabel(item.recordedAt)}` : ''}</Text>{item.snippet ? <Text style={styles.snippet}>{item.snippet}</Text> : null}</View>
            <Text style={styles.expand}>{selected ? '접기' : '상세'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`${item.title} 수정`} disabled={editBusy || editLoading} style={styles.editIconAction} onPress={() => void openEditor(item)}><Text style={styles.editIconText}>✏️</Text></Pressable>
        </View>
        {selected ? <View style={styles.detail}>
          {item.dueAt ? <Text style={styles.detailMeta}>기한: {recordedAtLabel(item.dueAt)}</Text> : <Text style={styles.detailMeta}>기한 없음</Text>}
        </View> : null}
      </View>;
    })}
    {hasMore ? <Button title={busy ? '더 불러오는 중...' : '더 보기'} disabled={busy} onPress={() => void search(false)} /> : null}
    {message ? <Text style={styles.message}>{message}</Text> : null}
    <WorkRecordEditSheet
      visible={Boolean(editId)}
      title={editTitle}
      date={editDate}
      time={editTime}
      loading={editLoading}
      saving={editBusy}
      ready={editReady}
      actionKind={editActionKind}
      actionConversionAllowed={editActionConversionAllowed}
      statusText={editStatus}
      statusTone={editStatusTone}
      onTitle={setEditTitle}
      onDate={setEditDate}
      onTime={setEditTime}
      onActionKind={setEditActionKind}
      onSave={() => void saveEditor()}
      onCancel={cancelEditor}
      onRetry={() => void retryEditor()}
    />
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
  resultHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  resultMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  resultCopy: { flex: 1, minWidth: 0, gap: 4 },
  expand: { fontSize: 12, fontWeight: '800', color: '#275daf', paddingVertical: 4 },
  detail: { gap: 8, padding: 10, borderRadius: 10, backgroundColor: '#f8fafc' },
  detailMeta: { fontSize: 12, color: '#737985', lineHeight: 18 },
  editIconAction: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: '#cfd5dd', backgroundColor: '#fff' },
  editIconText: { fontSize: 18 },
  title: { fontSize: 15, fontWeight: '800', color: '#30343b', lineHeight: 21 },
  meta: { fontSize: 12, color: '#737985', lineHeight: 18 },
  snippet: { fontSize: 13, color: '#4b515c', lineHeight: 19 },
  message: { fontSize: 13, color: '#4b515c', lineHeight: 19, backgroundColor: '#f4f7fb', padding: 10, borderRadius: 10 },
});
