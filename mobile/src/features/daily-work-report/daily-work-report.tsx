import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PublicPlatformConfig } from '@/src/platform/config';
import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import { mobileTheme } from '@/src/ui/theme';
import { workspaceStyles } from '@/src/ui/workspace-styles';
import { seoulDate } from '../home/home-calendar-model';
import {
  dailyReportApi, reportAccessLost, reportErrorMessage,
  type DailyReport, type DailyReportApi, type ReportDraft, type ReportGrant, type ReportSchedule,
} from './daily-work-report-api';

const title = '태장 일일 업무일지';
const fields = [
  ['work_done', '오늘의 업무 내용'],
  ['staff_notes', '근로자 특이사항'],
  ['other_notes', '기타 · 보고가 필요한 내용'],
] as const;
const time = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit' });
const draftFor = (row: DailyReport | null): ReportDraft => ({
  work_date: row?.work_date ?? seoulDate(), morning: row?.morning ?? false, afternoon: row?.afternoon ?? false,
  work_done: row?.work_done ?? '', staff_notes: row?.staff_notes ?? '', other_notes: row?.other_notes ?? '',
});

type Grant = { api: DailyReportApi; info: ReportGrant; current: () => boolean };

export function useTaejangDailyReportAccess(client: PlatformSupabaseClient | null, config: PublicPlatformConfig | null, ownerId: string | undefined) {
  const [granted, setGranted] = useState<(Grant & { client: PlatformSupabaseClient; config: PublicPlatformConfig; ownerId: string }) | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const retry = useRef<() => void>(() => undefined);

  function revoke() { setGranted(null); }

  useEffect(() => {
    setGranted(null);
    setChecking(false);
    setCheckFailed(false);
    retry.current = () => undefined;
    if (!client || config?.dataSchema !== 'worklog' || !ownerId) return;
    let valid = true;
    let checkNumber = 0;
    const current = () => valid;
    const api = dailyReportApi({ client, config, ownerId, current });
    const check = async () => {
      if (!valid) return;
      const request = ++checkNumber;
      setChecking(true);
      setCheckFailed(false);
      try {
        const info = await api.access();
        if (!valid || request !== checkNumber) return;
        if (!info || typeof info.author_name !== 'string' || typeof info.can_read_all !== 'boolean') {
          revoke();
          return;
        }
        setGranted({ api, info, current, client, config, ownerId });
      } catch (error) {
        if (valid && request === checkNumber) {
          if (reportAccessLost(error)) revoke();
          else setCheckFailed(true);
        }
      } finally {
        if (valid && request === checkNumber) setChecking(false);
      }
    };
    retry.current = () => void check();
    const auth = client.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION' || session?.user.id === ownerId) return;
      valid = false;
      revoke();
    });
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') void check();
    });
    void check();
    return () => {
      valid = false;
      auth.data.subscription.unsubscribe();
      appState.remove();
    };
  }, [client, config, ownerId]);

  const grant = granted?.client === client && granted?.config === config && granted?.ownerId === ownerId
    && granted?.current() ? granted : null;
  return { grant, checking, checkFailed, retry: retry.current, revoke };
}

export function TaejangDailyReport({ access }: { access: ReturnType<typeof useTaejangDailyReportAccess> }) {
  const [opened, setOpened] = useState(false);
  const { grant, checking, checkFailed, retry, revoke } = access;
  if (!grant) return null;
  return <>
    <Pressable accessibilityRole="button" disabled={checking} style={[workspaceStyles.card, workspaceStyles.heading]}
      onPress={() => { setOpened(true); retry(); }}>
      <Text style={workspaceStyles.title}>{title}</Text>
      <Text style={workspaceStyles.link} accessibilityElementsHidden importantForAccessibility="no">›</Text>
    </Pressable>
    {opened ? <ReportSheet key={String(grant.info.can_read_all)} grant={grant} checking={checking} checkFailed={checkFailed}
      retry={retry} onAccessLost={revoke} onClose={() => setOpened(false)} /> : null}
  </>;
}

function ReportSheet({ grant, checking, checkFailed, retry, onAccessLost, onClose }: {
  grant: Grant; checking: boolean; checkFailed: boolean; retry: () => void; onAccessLost: () => void; onClose: () => void;
}) {
  const { api, info } = grant;
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<DailyReport[]>([]);
  const [page, setPage] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [editor, setEditor] = useState<{ row: DailyReport | null; draft: ReportDraft } | null>(null);
  const [candidates, setCandidates] = useState<ReportSchedule[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState(false);
  const [pickingDate, setPickingDate] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const mounted = useRef(true);
  const pending = useRef(false);
  const current = () => mounted.current && grant.current();

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!checking && !checkFailed && !loaded && !busy && !message) void load(0);
  }, [checking, checkFailed, loaded, busy, message]);

  const operate = async (action: () => Promise<void>) => {
    if (pending.current || !current()) return;
    pending.current = true;
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      if (!current()) return;
      if (reportAccessLost(error)) onAccessLost();
      else {
        if (String(error).includes('DAILY_WORK_SCHEDULE_CHANGED')) clearSchedules();
        setMessage(reportErrorMessage(error));
      }
    } finally {
      pending.current = false;
      if (current()) setBusy(false);
    }
  };

  function load(next: number) {
    return operate(async () => {
      const reports = await api.list(next);
      if (!current()) return;
      setRows(reports);
      setPage(next);
      setLoaded(true);
    });
  }

  function clearSchedules() {
    setCandidates(null);
    setSelected([]);
    setPreview(false);
  }

  function openSaved(id: number) {
    return operate(async () => {
      const reports = await api.list(page);
      if (!current()) return;
      setRows(reports);
      const row = reports.slice(0, 50).find(report => report.id === id);
      if (row) open(row);
      else setMessage('일지 목록이 변경됐습니다. 다시 선택해 주세요.');
    });
  }

  function open(row: DailyReport | null) {
    setEditor({ row, draft: draftFor(row) });
    setDirty(false);
    setMessage('');
    setPickingDate(false);
    clearSchedules();
  }

  function close(action: () => void) {
    if (pending.current) return;
    if (!dirty && !selected.length) return action();
    Alert.alert('저장하지 않은 내용이 있습니다', '이 화면을 닫으면 수정 중인 입력이 사라집니다.', [
      { text: '계속 작성', style: 'cancel' },
      { text: '닫기', style: 'destructive', onPress: action },
    ]);
  }

  function patch(value: Partial<ReportDraft>) {
    if (pending.current || !editor) return;
    if (value.work_date !== undefined && value.work_date !== editor.draft.work_date) clearSchedules();
    setEditor({ ...editor, draft: { ...editor.draft, ...value } });
    setDirty(true);
  }

  const edit = editor?.row?.can_edit !== false;
  const draft = editor?.draft;
  const chosen = candidates?.filter(row => selected.includes(row.id)) ?? [];
  const date = draft?.work_date ?? '';
  const timestamp = Date.parse(date + 'T00:00:00Z');
  const dateValid = date >= '2000-01-01' && date <= '2100-12-31' && Number.isFinite(timestamp)
    && new Date(timestamp).toISOString().slice(0, 10) === date;

  function save() {
    if (!editor || !draft || !edit || !dateValid) return;
    if (!draft.morning && !draft.afternoon) return setMessage('오전 또는 오후를 선택해 주세요.');
    if (selected.length && !preview) return setMessage('선택한 일정을 미리보기에서 확인해 주세요.');
    if (!draft.work_done.trim() && !chosen.length) return setMessage('오늘의 업무 내용을 입력하거나 수행한 일정을 선택해 주세요.');
    void operate(async () => {
      const row = await api.save(draft, editor.row?.revision ?? 0, chosen);
      if (!current()) return;
      open(row);
      setMessage('ERP에 일지를 저장했습니다.');
    });
  }

  function readSchedules() {
    if (!draft || !dateValid) return setMessage('일지 날짜를 먼저 선택해 주세요.');
    void operate(async () => {
      const list = await api.schedules(draft.work_date);
      if (!current()) return;
      clearSchedules();
      setCandidates(list);
    });
  }

  return <Modal animationType="slide" onRequestClose={() => close(onClose)}>
    <KeyboardAvoidingView style={[styles.page, { paddingTop: insets.top }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={workspaceStyles.title}>{title}</Text>
        <Action label="닫기" disabled={busy} onPress={() => close(onClose)} />
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        {checking ? <ActivityIndicator accessibilityLabel="접근 권한 확인 중" />
          : checkFailed ? <Action label="접근 권한 다시 확인" onPress={retry} />
          : <>
            {message ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{message}</Text> : null}
            {busy ? <ActivityIndicator accessibilityLabel="일지 처리 중" /> : null}
            {!editor || !draft ? <>
              <View style={styles.actions}>
                <Action label="새 일지" primary disabled={busy} onPress={() => open(null)} />
                <Action label="새로고침" disabled={busy} onPress={() => void load(0)} />
              </View>
              <Text style={workspaceStyles.empty}>{info.can_read_all ? '다른 직원의 일지는 읽기 전용입니다.' : '저장한 내 일지'}</Text>
              {loaded && !rows.length ? <Text style={workspaceStyles.empty}>저장한 일지가 없습니다.</Text> : null}
              {rows.slice(0, 50).map(row => <Pressable accessibilityRole="button" key={row.id} disabled={busy}
                style={workspaceStyles.card} onPress={() => void openSaved(row.id)}>
                <Text style={styles.label}>{row.work_date} · {row.author_name}</Text>
                <Text numberOfLines={1} style={workspaceStyles.empty}>{row.work_done}</Text>
              </Pressable>)}
              <View style={styles.actions}>
                {page ? <Action label="이전" disabled={busy} onPress={() => void load(page - 1)} /> : null}
                {rows.length > 50 && page < 1000 ? <Action label="다음" disabled={busy} onPress={() => void load(page + 1)} /> : null}
              </View>
            </> : <>
              <Action label="일지 목록" disabled={busy} onPress={() => close(() => {
                setEditor(null); setDirty(false); clearSchedules(); void load(page);
              })} />
              <Text style={styles.label}>작성자 · {editor.row?.author_name ?? info.author_name}{edit ? '' : ' · 읽기 전용'}</Text>
              {editor.row ? <Text style={styles.label}>작성일 · {draft.work_date}</Text>
                : Platform.OS === 'web' ? <TextInput accessibilityLabel="작성일" value={draft.work_date} style={styles.input}
                  editable={!busy} onChangeText={work_date => patch({ work_date })} />
                : <Action label={'작성일 · ' + draft.work_date} disabled={busy} onPress={() => setPickingDate(true)} />}
              {pickingDate ? <>
                <DateTimePicker mode="date" value={new Date(draft.work_date + 'T12:00:00+09:00')}
                  minimumDate={new Date('2000-01-01T00:00:00+09:00')} maximumDate={new Date('2100-12-31T23:59:59+09:00')}
                  timeZoneName="Asia/Seoul" locale="ko-KR" display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(_, value) => {
                    if (Platform.OS !== 'ios') setPickingDate(false);
                    if (value) patch({ work_date: seoulDate(value.getTime()) });
                  }} />
                {Platform.OS === 'ios' ? <Action label="선택 완료" onPress={() => setPickingDate(false)} /> : null}
              </> : null}
              <View style={styles.actions}>
                <Action label="오전" checked={draft.morning} disabled={!edit || busy} onPress={() => patch({ morning: !draft.morning })} />
                <Action label="오후" checked={draft.afternoon} disabled={!edit || busy} onPress={() => patch({ afternoon: !draft.afternoon })} />
              </View>
              {fields.map(([key, label]) => <View key={key} style={styles.field}>
                <Text style={styles.label}>{label}</Text>
                {edit ? <TextInput accessibilityLabel={label} value={draft[key]} editable={!busy} multiline maxLength={8000}
                  style={[styles.input, styles.body]} onChangeText={value => patch({ [key]: value })} />
                  : <Text selectable style={styles.readOnly}>{draft[key] || '—'}</Text>}
              </View>)}
              <View style={styles.actions}><Text style={styles.approval}>이사 확인란</Text><Text style={styles.approval}>대표 확인란</Text></View>
              {edit ? <>
                {candidates === null ? <Action label="업무수첩 일정 가져오기" disabled={busy} onPress={readSchedules} />
                  : <View style={workspaceStyles.card}>
                    <Text accessibilityRole="header" style={styles.label}>{preview ? '업무 내용에 추가할 일정' : '수행한 일정 선택'}</Text>
                    {preview ? <>
                      {chosen.map(row => <Text key={row.id}>- {row.title}</Text>)}
                      <Text style={workspaceStyles.empty}>일지를 저장하면 기존 업무 내용 끝에 추가됩니다.</Text>
                    </> : <>
                      {!candidates.length ? <Text style={workspaceStyles.empty}>가져올 일정이 없습니다.</Text> : null}
                      {candidates.map(row => <Action key={row.id}
                        label={(row.all_day ? '종일' : time.format(new Date(row.starts_at))) + ' · ' + row.title}
                        checked={selected.includes(row.id)} disabled={busy} onPress={() => {
                          if (!selected.includes(row.id) && selected.length >= 100) {
                            setMessage('한 번에 일정 100개까지 선택할 수 있습니다.');
                            return;
                          }
                          setSelected(ids => ids.includes(row.id) ? ids.filter(id => id !== row.id) : [...ids, row.id]);
                        }} />)}
                    </>}
                    <View style={styles.actions}>
                      {preview ? <Action label="선택 변경" disabled={busy} onPress={() => setPreview(false)} />
                        : <Action label="선택 일정 미리보기" disabled={busy || !selected.length} onPress={() => setPreview(true)} />}
                      <Action label="일정 선택 취소" disabled={busy} onPress={clearSchedules} />
                    </View>
                  </View>}
                <Action label="일지 저장" primary disabled={busy || !dateValid || (!!selected.length && !preview)} onPress={save} />
              </> : null}
            </>}
          </>}
      </ScrollView>
    </KeyboardAvoidingView>
  </Modal>;
}

function Action({ label, onPress, disabled = false, primary = false, checked }: {
  label: string; onPress: () => void; disabled?: boolean; primary?: boolean; checked?: boolean;
}) {
  return <Pressable accessibilityRole={checked === undefined ? 'button' : 'checkbox'} accessibilityLabel={label}
    accessibilityState={{ disabled, ...(checked === undefined ? {} : { checked }) }} disabled={disabled}
    style={[workspaceStyles.filter, primary && styles.primary, checked && workspaceStyles.filterActive, disabled && styles.disabled]}
    onPress={onPress}>
    <Text style={[styles.label, primary && styles.primaryText]}>{checked === undefined ? label : (checked ? '☑ ' : '☐ ') + label}</Text>
  </Pressable>;
}

const { colors, radius } = mobileTheme;
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surface },
  header: { ...workspaceStyles.heading, gap: 8, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.border },
  content: { padding: 16, gap: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  field: { gap: 6 },
  label: { fontWeight: '600', color: colors.text },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 12, color: colors.text },
  body: { minHeight: 86, textAlignVertical: 'top' },
  readOnly: { paddingVertical: 4, color: colors.text },
  approval: { padding: 10, borderWidth: 1, borderColor: colors.border, color: colors.textSecondary },
  notice: { color: colors.textSecondary, lineHeight: 20 },
  primary: { backgroundColor: colors.primary, alignItems: 'center' },
  primaryText: { color: colors.primaryText },
  disabled: { opacity: 0.55 },
});
