import { recordRowStyles } from '@/src/ui/record-row-styles';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import { importPickedCaptureImage, removeCaptureImage } from '@/src/features/capture/capture-files';
import { pickCaptureImage } from '@/src/features/capture/capture-gallery-picker';
import { captureImportState } from '@/src/features/capture/capture-runtime';
import { recognizeCapture } from '@/src/features/capture/capture-ocr';
import { subscriptionReceiptDraft } from './subscription-receipt-draft';
import { mobileTheme } from '@/src/ui/theme';
import { draftFromSubscription, SubscriptionForm, type FormAssist } from './subscription-form';
import {
  CYCLE_LABEL,
  EXPENSE_KIND_LABEL,
  expectedExpenseForMonth,
  paymentConfirmationDate,
  subscriptionPaymentLabel,
  SCOPE_LABEL,
  buildSubscriptionRows,
  filterByScope,
  formatWon,
  formatUsd,
  formatSubscriptionAmount,
  seoulDateKeyFromIso,
  summarizeSubscriptions,
  urgentItems,
  type ScopeFilter,
  type Subscription,
  type SubscriptionDraft,
  type SubscriptionRow,
} from './subscription-model';
import {
  readSubscriptionReminderPermission,
  requestSubscriptionReminderPermission,
  syncSubscriptionReminders,
} from './subscription-reminders';
import {
  UTTERANCE_FIELD_LABEL,
  draftFromUtterance,
  parseSubscriptionUtterance,
  type UtteranceParse,
} from './subscription-utterance';
import {
  amountFromRow,
  archiveSubscription,
  confirmSubscriptionPayment,
  listPaymentReceipts,
  type PaymentReceipt,
  createSubscription,
  listSubscriptions,
  markSubscriptionUsed,
  updateSubscription,
  type SubscriptionInput,
} from './subscription-store';

const FILTERS: { key: ScopeFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'business', label: '사업' },
  { key: 'personal', label: '개인' },
];

type Editing = { kind: 'compose' } | { kind: 'new'; parse?: UtteranceParse; receipt?: Partial<SubscriptionDraft> } | { kind: 'edit'; id: string } | null;
type PermissionState = 'checking' | 'granted' | 'undetermined' | 'denied' | 'unsupported';

function formatTotals(krw: number, usd: number, showUsd = usd > 0) {
  if (showUsd) return krw > 0 ? `${formatWon(krw)} + ${formatUsd(usd)}` : formatUsd(usd);
  return formatWon(krw);
}

function monthlyExpenseLabel(subs: readonly Subscription[], today: string) {
  return formatTotals(expectedExpenseForMonth(subs, today), expectedExpenseForMonth(subs, today, 'USD'), subs.some(sub => sub.amountUsdCents !== undefined));
}

function receiptAmountLabel(receipt: PaymentReceipt) {
  const amount = amountFromRow(receipt);
  return amount ? formatSubscriptionAmount(amount) : '금액 확인 필요';
}

const todayKey = () => seoulDateKeyFromIso(new Date().toISOString()) as string;
const shortDate = (key: string) => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
const dayLabel = (days: number) => (days === 0 ? '오늘' : days === 1 ? '내일' : `${days}일 뒤`);

export function SubscriptionsScreen({ client, ownerId }: { client: PlatformSupabaseClient; ownerId:string }) {
  const [receipts, setReceipts] = useState<PaymentReceipt[]>([]);
  const mutation = useRef(false);
  const receiptsRef=useRef<PaymentReceipt[]>([]);
  const snapshotReady=useRef(false);
  const createId = useRef<string | null>(null);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<ScopeFilter>('all');
  const [editing, setEditing] = useState<Editing>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [readingReceipt, setReadingReceipt] = useState(false);
  const [quickText, setQuickText] = useState('');
  const [permission, setPermission] = useState<PermissionState>('checking');
  const alive = useRef(true);
  const lastScope = useRef<'business' | 'personal'>('business');

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const refreshPermission = useCallback(async () => {
    try { const p = await readSubscriptionReminderPermission(); if (alive.current) setPermission(p); }
    catch { if (alive.current) setPermission('undetermined'); }
  }, []);

  const syncReminders = useCallback((next: Subscription[], paid=receiptsRef.current) => {
    if(!snapshotReady.current)return;
    void syncSubscriptionReminders(next, todayKey(), Date.now(), paid, ()=>alive.current, ownerId).then((r) => {
      if (alive.current && r.status === 'permission-needed') setPermission((p) => (p === 'granted' ? 'undetermined' : p));
    }).catch(() => undefined);
  }, [ownerId]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [next, paid] = await Promise.all([listSubscriptions(client), listPaymentReceipts(client)]);
      if (!alive.current) return;
      snapshotReady.current=true;
      setSubs(next);
      receiptsRef.current=paid;
      setReceipts(paid);
      syncReminders(next);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : '구독 목록을 불러오지 못했습니다.');
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [client, syncReminders]);

  useEffect(() => { void load(); void refreshPermission(); }, [load, refreshPermission]);

  const today = todayKey();
  const visible = useMemo(() => filterByScope(subs, filter), [subs, filter]);
  const summary = useMemo(() => summarizeSubscriptions(visible), [visible]);
  const allSummary = useMemo(() => summarizeSubscriptions(subs), [subs]);
  const rows = useMemo(() => buildSubscriptionRows(subs, filter, today), [subs, filter, today]);
  const urgent = useMemo(() => urgentItems(visible, today), [visible, today]);

  function applyChange(next: Subscription[]) { setSubs(next); if(snapshotReady.current)syncReminders(next);else void load(); }

  function openFromQuickText() {
    const text = quickText.replace(/\s+/g, ' ').trim();
    if (!text) { setError('추가할 구독을 한 줄로 적어주세요. 예: 사업 클라우드 매달 1만 2천원 15일'); return; }
    setError('');
    setEditing({ kind: 'new', parse: parseSubscriptionUtterance(text, todayKey(), subs.map((s) => s.name)) });
    setQuickText('');
  }

  function openCompose() { createId.current = Crypto.randomUUID(); setError(''); setQuickText(''); setEditing({ kind: 'compose' }); }

  async function importReceipt() {
    if (captureImportState.galleryActive) return;
    captureImportState.galleryActive = true;
    setReadingReceipt(true);
    setError('');
    try {
      const uri = await pickCaptureImage();
      if (!uri) return;
      const image = await importPickedCaptureImage(uri);
      try {
        if (!alive.current) return;
        const text = await recognizeCapture(image.uri);
        if (!alive.current) return;
        const receipt = subscriptionReceiptDraft(text);
        if (!receipt) {
          setError(text ? '이 영수증에서 구독 정보를 찾지 못했어요. 다른 결제 내역을 고르거나 직접 입력해주세요.' : '사진에서 글자를 읽지 못했어요. 다른 사진을 고르거나 직접 입력해주세요.');
          return;
        }
        setEditing({ kind: 'new', receipt });
      } finally {
        await removeCaptureImage(image.uri).catch(() => undefined);
      }
    } catch {
      if (alive.current) setError('사진을 읽지 못했어요. 다른 사진을 고르거나 직접 입력해주세요.');
    } finally {
      captureImportState.galleryActive = false;
      if (alive.current) setReadingReceipt(false);
    }
  }

  async function save(input: SubscriptionInput) {
    if (!editing || editing.kind === 'compose' || mutation.current) return;
    mutation.current = true;
    setBusyId('form'); setError('');
    try {
      if (editing.kind === 'new') {
        const created = await createSubscription(client, { ...input, sourceText: editing.parse?.rawText || null }, createId.current || (createId.current = Crypto.randomUUID()));
        lastScope.current = created.scope;
        if (alive.current) applyChange([...subs, created]);
      } else {
        const updated = await updateSubscription(client, editing.id, input);
        if (alive.current) applyChange(subs.map((s) => (s.id === updated.id ? updated : s)));
      }
      if (alive.current) setEditing(null);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : '저장하지 못했습니다. 입력은 유지했습니다.');
    } finally {
      mutation.current = false;
      if (alive.current) setBusyId(null);
    }
  }

  async function markUsed(id: string) {
    if (mutation.current) return;
    mutation.current = true;
    setBusyId(id); setError('');
    try {
      const updated = await markSubscriptionUsed(client, id, todayKey());
      if (alive.current) applyChange(subs.map((s) => (s.id === updated.id ? updated : s)));
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : '사용 기록을 저장하지 못했습니다.');
    } finally {
      mutation.current = false;
      if (alive.current) setBusyId(null);
    }
  }

  async function confirmPaid(sub: Subscription) {
    if (mutation.current) return;
    mutation.current = true; setBusyId(sub.id); setError('');
    try {
      const paid = await confirmSubscriptionPayment(client, sub.id, paymentConfirmationDate(sub, todayKey()));
      if (alive.current) {const next=[...receiptsRef.current.filter(r => r.subscription_id !== paid.subscription_id || r.due_date !== paid.due_date), paid];receiptsRef.current=next;setReceipts(next);syncReminders(subs,next);}
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '납부 저장 확인 필요'); }
    finally { mutation.current = false; if (alive.current) setBusyId(null); }
  }

  function confirmDelete(sub: Subscription) {
    Alert.alert('정기지출 종료', `‘${sub.name}’의 미래 예정과 알림을 중단할까요? 기존 기록은 보존됩니다.`, [
      { text: '취소', style: 'cancel' },
      { text: '종료', style: 'destructive', onPress: () => { void remove(sub.id); } },
    ]);
  }

  async function remove(id: string) {
    if (mutation.current) return;
    mutation.current = true;
    setBusyId('form'); setError('');
    try {
      await archiveSubscription(client, id);
      if (alive.current) { applyChange(subs.filter((s) => s.id !== id)); setEditing(null); }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : '삭제하지 못했습니다.');
    } finally {
      mutation.current = false;
      if (alive.current) setBusyId(null);
    }
  }

  async function enableReminders() {
    try {
      const granted = await requestSubscriptionReminderPermission();
      await refreshPermission();
      if (!alive.current) return;
      if (granted) syncReminders(subs);
      else Alert.alert('알림 권한 필요', '휴대폰 설정에서 업무수첩 알림을 허용하면 결제일 하루 전에 알려드립니다.');
    } catch { setError('알림 설정을 확인하지 못했습니다.'); }
  }

  const editingSub = editing?.kind === 'edit' ? subs.find((s) => s.id === editing.id) || null : null;

  if (editing?.kind === 'compose') {
    return <View style={styles.root}>
      {Platform.OS === 'android' ? <Pressable accessibilityRole="button" disabled={readingReceipt} accessibilityState={{ busy: readingReceipt, disabled: readingReceipt }} style={styles.quickButton} onPress={() => void importReceipt()}>
        <Text style={styles.quickButtonText}>{readingReceipt ? '결제 내역 읽는 중…' : '결제 캡처 가져오기'}</Text>
      </Pressable> : null}
      <View style={styles.quickCard}>
        <Text style={styles.quickTitle}>말하거나 한 줄로 적기</Text>
        <TextInput accessibilityLabel="구독을 한 줄로 입력" autoFocus={Platform.OS !== 'android'} multiline editable={!readingReceipt} style={[styles.quickInput, styles.quickInputBig]} value={quickText} maxLength={300} placeholder="예: 사업 클라우드 매달 1만 2천원 15일" onChangeText={setQuickText} />
        <Text style={styles.quickHelp}>키보드의 마이크 버튼으로 말해도 돼요. 읽은 내용은 저장 전에 꼭 확인할 수 있어요.</Text>
        {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="한 줄 내용 확인하기" disabled={readingReceipt} style={styles.addButton} onPress={openFromQuickText}><Text style={styles.addText}>내용 확인하기</Text></Pressable>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="폼에 직접 입력하기" disabled={readingReceipt} style={styles.quickButton} onPress={() => { setError(''); setEditing({ kind: 'new' }); }}><Text style={styles.quickButtonText}>직접 입력하기</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="목록으로 돌아가기" disabled={readingReceipt} style={styles.linkButton} onPress={() => { setEditing(null); setError(''); setQuickText(''); }}><Text style={styles.link}>목록으로</Text></Pressable>
    </View>;
  }

  if (editing && (editing.kind === 'new' || editingSub)) {
    const parse = editing.kind === 'new' ? editing.parse : undefined;
    const receipt = editing.kind === 'new' ? editing.receipt : undefined;
    const defaultScope = filter === 'all' ? lastScope.current : filter;
    const initial = parse ? draftFromUtterance(parse, defaultScope) : draftFromSubscription(editingSub, today, defaultScope);
    if (receipt) Object.assign(initial, { cycle: '', billingAnchorDate: '', ...receipt });
    const assist: FormAssist | undefined = parse ? {
      rawText: parse.rawText,
      missingLabels: parse.missing.map((field) => UTTERANCE_FIELD_LABEL[field]),
      warnings: parse.warnings,
      nameCandidates: parse.nameCandidates,
    } : undefined;
    return <View style={styles.root}>
      {receipt ? <Text style={styles.noticeText}>사진에서 읽은 내용입니다. 금액과 결제 주기, 다음 결제일을 확인한 뒤 저장해주세요.</Text> : null}
      {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
      <SubscriptionForm
        key={editing.kind === 'new' ? `new:${parse?.rawText || ''}` : editing.id}
        initial={initial}
        assist={assist}
        sourceText={editingSub?.sourceText}
        isNew={editing.kind === 'new'}
        busy={busyId === 'form'}
        onSave={(value) => void save(value)}
        onCancel={() => { setEditing(null); setError(''); }}
        onDelete={editingSub ? () => confirmDelete(editingSub) : undefined}
      />
    </View>;
  }

  return <View style={styles.root}>
    <Pressable accessibilityRole="button" accessibilityLabel="구독 추가" style={styles.addButton} onPress={openCompose}>
      <Text style={styles.addText}>+ 구독 추가</Text>
    </Pressable>

    <View style={styles.summaryCard} accessibilityRole="summary">
      <Text style={styles.summaryLabel}>{filter === 'all' ? '이번 달 예상 지출' : `이번 달 ${SCOPE_LABEL[filter]} 예상 지출`}</Text>
      <Text style={styles.summaryAmount}>{monthlyExpenseLabel(visible, today)}</Text>
      <Text style={styles.summarySub}>월 환산 {formatTotals(summary.monthlyTotalKrw, summary.monthlyTotalUsdCents)} · 연 환산 {formatTotals(summary.yearlyTotalKrw, summary.yearlyTotalUsdCents)} · {summary.count}개</Text>
      {filter === 'all' && subs.length > 0 ? <Text style={styles.summarySplit}>사업 {monthlyExpenseLabel(filterByScope(subs,'business'),today)} · 개인 {monthlyExpenseLabel(filterByScope(subs,'personal'),today)}</Text> : null}
    </View>

    <View style={styles.filters}>
      {FILTERS.map((f) => <Pressable key={f.key} accessibilityRole="button" accessibilityState={{ selected: filter === f.key }} style={[styles.filter, filter === f.key ? styles.filterActive : null]} onPress={() => setFilter(f.key)}>
        <Text style={filter === f.key ? styles.filterActiveText : styles.filterText}>{f.label} {f.key === 'all' ? subs.length : f.key === 'business' ? allSummary.byScope.business.count : allSummary.byScope.personal.count}</Text>
      </Pressable>)}
    </View>

    {error ? <View style={styles.errorBox}><Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text><Pressable accessibilityRole="button" style={styles.linkButton} onPress={() => void load()}><Text style={styles.link}>다시 불러오기</Text></Pressable></View> : null}

    {permission !== 'granted' && permission !== 'checking' && permission !== 'unsupported' && subs.length > 0 ? <View style={styles.noticeBox}>
      <Text style={styles.noticeText}>결제일·해지기한 하루 전 아침 9시에 알려드릴 수 있어요.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="구독 알림 켜기" style={styles.linkButton} onPress={() => void enableReminders()}><Text style={styles.link}>알림 켜기</Text></Pressable>
    </View> : null}

    {urgent.length > 0 ? <View style={styles.urgentBox}>
      <Text style={styles.urgentTitle}>이번 주 확인</Text>
      {urgent.map((item) => <Text key={`${item.kind}-${item.subscription.id}`} style={styles.urgentRow}>
        {item.kind === 'payment' ? '결제' : '해지기한'} {shortDate(item.date)} ({dayLabel(item.daysUntil)}) · {item.subscription.name}{item.kind === 'payment' ? ` ${formatSubscriptionAmount(item.subscription)}` : ''}
      </Text>)}
    </View> : null}

    {loading && subs.length === 0 ? <Text style={styles.empty}>불러오는 중…</Text> : null}
    {!loading && !error && subs.length === 0 ? <Text style={styles.empty}>등록된 구독이 없어요.</Text> : null}
    {!loading && subs.length > 0 && rows.length === 0 ? <Text style={styles.empty}>이 구분에는 등록된 구독이 없어요.</Text> : null}

    {rows.map((row) => <Row paid={receipts.some(r => r.subscription_id === row.subscription.id && r.due_date === paymentConfirmationDate(row.subscription, today))} due={paymentConfirmationDate(row.subscription, today)} onPaid={() => void confirmPaid(row.subscription)} key={row.subscription.id} row={row} busy={busyId === row.subscription.id} onUsed={() => void markUsed(row.subscription.id)} onEdit={() => setEditing({ kind: 'edit', id: row.subscription.id })} />)}

    {receipts.length ? <View style={styles.urgentBox}><Text style={styles.urgentTitle}>납부 이력</Text>{receipts.slice(0, 20).map(r => <Text key={`${r.subscription_id}:${r.due_date}`} style={styles.rowMeta}>{r.due_date} · {r.name} · {receiptAmountLabel(r)}{r.variable_amount ? ' (예상액 기준)' : ''} · 확인됨</Text>)}</View> : null}
  </View>;
}

function Row({ row, busy, onUsed, onEdit, paid, due, onPaid }: { paid: boolean; due: string; onPaid: () => void; row: SubscriptionRow; busy: boolean; onUsed: () => void; onEdit: () => void }) {
  const { subscription: s } = row;
  const idle = row.usedToday ? '오늘 사용' : row.idleDays === null ? '사용 기록 없음' : row.idleDays === 0 ? '오늘 등록' : `마지막 사용 ${row.idleDays}일 전`;
  return <View style={[styles.row, row.cancelCandidate ? styles.rowCandidate : null]}>
    <View style={styles.rowTop}>
      <Text style={styles.rowName} numberOfLines={2}>{s.name}</Text>
      <Text style={styles.rowAmount}>{s.amountUsdCents === undefined ? formatWon(row.monthlyAmountKrw) : formatUsd(row.monthlyAmountUsdCents)}<Text style={styles.rowAmountUnit}> /월</Text></Text>
    </View>
    <Text style={styles.rowMeta}>
      {EXPENSE_KIND_LABEL[s.expenseKind || 'subscription']} · {SCOPE_LABEL[s.scope]} · {s.variableAmount ? '예상 ' : ''}{CYCLE_LABEL[s.cycle]} {formatSubscriptionAmount(s)} · 다음 결제 {shortDate(row.nextPayment)} ({dayLabel(row.daysToPayment)})
    </Text>
    {subscriptionPaymentLabel(s) ? <Text style={styles.rowMeta}>{subscriptionPaymentLabel(s)}</Text> : null}
    {(!s.expenseKind || s.expenseKind === 'subscription') ? <Text style={[styles.rowMeta, row.cancelCandidate ? styles.candidateText : null]}>{row.cancelCandidate ? `해지 후보 · ${idle}` : idle}</Text> : null}
    <View style={styles.rowActions}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${s.name} ${due} 납부 확인`} disabled={busy || paid} style={styles.rowButton} onPress={onPaid}><Text style={styles.rowButtonText}>{busy ? '저장 중…' : paid ? `${shortDate(due)} 납부 확인됨` : `${shortDate(due)} 납부 확인`}</Text></Pressable>
      {(!s.expenseKind || s.expenseKind === 'subscription') ? <Pressable accessibilityRole="button" accessibilityLabel={`${s.name} 오늘 사용함으로 기록`} disabled={busy || row.usedToday} style={[styles.rowButton, row.usedToday ? styles.rowButtonDone : null]} onPress={onUsed}>
        <Text style={styles.rowButtonText}>{row.usedToday ? '✓ 오늘 썼음' : busy ? '저장 중…' : '오늘 썼음'}</Text>
      </Pressable> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`${s.name} 수정`} disabled={busy} style={styles.rowButton} onPress={onEdit}><Text style={styles.rowButtonText}>수정</Text></Pressable>
    </View>
  </View>;
}

const c = mobileTheme.colors;
const styles = StyleSheet.create({
  root: { gap: 12 },
  summaryCard: { backgroundColor: c.primary, borderRadius: mobileTheme.radius.card, padding: mobileTheme.spacing.card, gap: 4 },
  summaryLabel: { color: '#cbd5e1', fontSize: 13 },
  summaryAmount: { color: c.primaryText, fontSize: 28, fontWeight: '800' },
  summarySub: { color: '#e2e8f0', fontSize: 14 },
  summarySplit: { color: '#e2e8f0', fontSize: 14, marginTop: 4 },
  filters: { flexDirection: 'row', gap: 8 },
  filter: { flex: 1, minHeight: mobileTheme.size.touchTarget, borderRadius: mobileTheme.radius.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' },
  filterActive: { backgroundColor: c.text, borderColor: c.text },
  filterText: { color: c.text, fontSize: 15 },
  filterActiveText: { color: c.primaryText, fontSize: 15, fontWeight: '700' },
  errorBox: { backgroundColor: c.overdueBackground, borderColor: c.overdueBorder, borderWidth: 1, borderRadius: mobileTheme.radius.control, padding: 12, gap: 4 },
  error: { color: c.danger, fontSize: 14, lineHeight: 20 },
  noticeBox: { backgroundColor: c.upcomingBackground, borderColor: c.upcomingBorder, borderWidth: 1, borderRadius: mobileTheme.radius.control, padding: 12, gap: 2 },
  noticeText: { color: c.textSecondary, fontSize: 14, lineHeight: 20 },
  linkButton: { minHeight: mobileTheme.size.touchTarget, justifyContent: 'center' },
  link: { color: c.link, fontSize: 15, fontWeight: '600' },
  urgentBox: { backgroundColor: c.todayBackground, borderColor: c.todayBorder, borderWidth: 1, borderRadius: mobileTheme.radius.control, padding: 12, gap: 4 },
  urgentTitle: { color: c.warning, fontWeight: '700', fontSize: 14 },
  urgentRow: { color: c.text, fontSize: 14, lineHeight: 20 },
  empty: { color: c.textMuted, fontSize: 14, lineHeight: 20, textAlign: 'center', paddingVertical: 16 },
  row: { backgroundColor: c.surface, borderRadius: mobileTheme.radius.card, padding: 16, gap: 4, borderWidth: 1, borderColor: c.borderSubtle },
  rowCandidate: { borderColor: c.overdueBorder, backgroundColor: c.overdueBackground },
  rowTop: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  rowName: { ...recordRowStyles.taskTitle, flexGrow: 1, flexShrink: 1, flexBasis: 140 },
  rowAmount: { fontSize: 17, fontWeight: '700', color: c.text },
  rowAmountUnit: { fontSize: 12, fontWeight: '400', color: c.textMuted },
  rowMeta: recordRowStyles.taskMeta,
  candidateText: { color: c.danger, fontWeight: '600' },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  rowButton: { flex: 1, minHeight: mobileTheme.size.touchTarget, borderRadius: mobileTheme.radius.control, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface },
  rowButtonDone: { backgroundColor: c.neutralBackground },
  rowButtonText: { fontSize: 15, color: c.text },
  quickCard: { backgroundColor: c.surface, borderRadius: mobileTheme.radius.card, borderWidth: 1, borderColor: c.borderSubtle, padding: 16, gap: 8 },
  quickTitle: { fontSize: 15, fontWeight: '700', color: c.text },
  quickInput: { minHeight: mobileTheme.size.input, borderWidth: 1, borderColor: c.border, borderRadius: mobileTheme.radius.control, paddingHorizontal: 12, fontSize: 16, color: c.text },
  quickInputBig: { minHeight: 96, paddingVertical: 12, textAlignVertical: 'top' },
  quickHelp: { fontSize: 12, color: c.textMuted, lineHeight: 18 },
  quickButton: { minHeight: mobileTheme.size.touchTarget, borderRadius: mobileTheme.radius.control, borderWidth: 1, borderColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  quickButtonText: { color: c.primary, fontSize: 16, fontWeight: '700' },
  addButton: { minHeight: mobileTheme.size.touchTarget, borderRadius: mobileTheme.radius.control, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  addText: { color: c.primaryText, fontSize: 16, fontWeight: '700' },
});
