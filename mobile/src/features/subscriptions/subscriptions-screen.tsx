import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import { mobileTheme } from '@/src/ui/theme';
import { draftFromSubscription, SubscriptionForm } from './subscription-form';
import {
  CYCLE_LABEL,
  SCOPE_LABEL,
  buildSubscriptionRows,
  filterByScope,
  formatWon,
  seoulDateKeyFromIso,
  summarizeSubscriptions,
  urgentItems,
  type ScopeFilter,
  type Subscription,
  type SubscriptionRow,
} from './subscription-model';
import {
  readSubscriptionReminderPermission,
  requestSubscriptionReminderPermission,
  syncSubscriptionReminders,
} from './subscription-reminders';
import {
  archiveSubscription,
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

type Editing = { kind: 'new' } | { kind: 'edit'; id: string } | null;
type PermissionState = 'checking' | 'granted' | 'undetermined' | 'denied' | 'unsupported';

const todayKey = () => seoulDateKeyFromIso(new Date().toISOString()) as string;
const shortDate = (key: string) => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
const dayLabel = (days: number) => (days === 0 ? '오늘' : days === 1 ? '내일' : `${days}일 뒤`);

export function SubscriptionsScreen({ client }: { client: PlatformSupabaseClient }) {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<ScopeFilter>('all');
  const [editing, setEditing] = useState<Editing>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [permission, setPermission] = useState<PermissionState>('checking');
  const alive = useRef(true);
  const lastScope = useRef<'business' | 'personal'>('business');

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const refreshPermission = useCallback(async () => {
    try { const p = await readSubscriptionReminderPermission(); if (alive.current) setPermission(p); }
    catch { if (alive.current) setPermission('undetermined'); }
  }, []);

  const syncReminders = useCallback((next: Subscription[]) => {
    void syncSubscriptionReminders(next, todayKey()).then((r) => {
      if (alive.current && r.status === 'permission-needed') setPermission((p) => (p === 'granted' ? 'undetermined' : p));
    }).catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const next = await listSubscriptions(client);
      if (!alive.current) return;
      setSubs(next);
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

  function applyChange(next: Subscription[]) { setSubs(next); syncReminders(next); }

  async function save(input: SubscriptionInput) {
    if (!editing || busyId) return;
    setBusyId('form'); setError('');
    try {
      if (editing.kind === 'new') {
        const created = await createSubscription(client, input);
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
      if (alive.current) setBusyId(null);
    }
  }

  async function markUsed(id: string) {
    if (busyId) return;
    setBusyId(id); setError('');
    try {
      const updated = await markSubscriptionUsed(client, id, todayKey());
      if (alive.current) applyChange(subs.map((s) => (s.id === updated.id ? updated : s)));
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : '사용 기록을 저장하지 못했습니다.');
    } finally {
      if (alive.current) setBusyId(null);
    }
  }

  function confirmDelete(sub: Subscription) {
    Alert.alert('구독 삭제', `‘${sub.name}’을(를) 목록에서 삭제할까요? 결제일 알림도 함께 사라집니다.`, [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => { void remove(sub.id); } },
    ]);
  }

  async function remove(id: string) {
    setBusyId('form'); setError('');
    try {
      await archiveSubscription(client, id);
      if (alive.current) { applyChange(subs.filter((s) => s.id !== id)); setEditing(null); }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : '삭제하지 못했습니다.');
    } finally {
      if (alive.current) setBusyId(null);
    }
  }

  async function enableReminders() {
    try {
      const granted = await requestSubscriptionReminderPermission();
      await refreshPermission();
      if (granted) syncReminders(subs);
      else Alert.alert('알림 권한 필요', '휴대폰 설정에서 업무수첩 알림을 허용하면 결제일 하루 전에 알려드립니다.');
    } catch { setError('알림 설정을 확인하지 못했습니다.'); }
  }

  const editingSub = editing?.kind === 'edit' ? subs.find((s) => s.id === editing.id) || null : null;

  if (editing && (editing.kind === 'new' || editingSub)) {
    return <View style={styles.root}>
      {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
      <SubscriptionForm
        key={editing.kind === 'new' ? 'new' : editing.id}
        initial={draftFromSubscription(editingSub, today, filter === 'all' ? lastScope.current : filter)}
        isNew={editing.kind === 'new'}
        busy={busyId === 'form'}
        onSave={(value) => void save(value)}
        onCancel={() => { setEditing(null); setError(''); }}
        onDelete={editingSub ? () => confirmDelete(editingSub) : undefined}
      />
    </View>;
  }

  return <View style={styles.root}>
    <View style={styles.summaryCard} accessibilityRole="summary">
      <Text style={styles.summaryLabel}>{filter === 'all' ? '이번 달 구독 총액' : `이번 달 ${SCOPE_LABEL[filter]} 구독`}</Text>
      <Text style={styles.summaryAmount}>{formatWon(summary.monthlyTotalKrw)}</Text>
      <Text style={styles.summarySub}>연 환산 {formatWon(summary.yearlyTotalKrw)} · {summary.count}개</Text>
      {filter === 'all' && subs.length > 0 ? <Text style={styles.summarySplit}>사업 {formatWon(allSummary.byScope.business.monthlyTotalKrw)} · 개인 {formatWon(allSummary.byScope.personal.monthlyTotalKrw)}</Text> : null}
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
        {item.kind === 'payment' ? '결제' : '해지기한'} {shortDate(item.date)} ({dayLabel(item.daysUntil)}) · {item.subscription.name}{item.kind === 'payment' ? ` ${formatWon(item.subscription.amountKrw)}` : ''}
      </Text>)}
    </View> : null}

    {loading && subs.length === 0 ? <Text style={styles.empty}>불러오는 중…</Text> : null}
    {!loading && !error && subs.length === 0 ? <Text style={styles.empty}>등록된 구독이 없어요. 아래 버튼으로 첫 구독을 추가해보세요.</Text> : null}
    {!loading && subs.length > 0 && rows.length === 0 ? <Text style={styles.empty}>이 구분에는 등록된 구독이 없어요.</Text> : null}

    {rows.map((row) => <Row key={row.subscription.id} row={row} busy={busyId === row.subscription.id} onUsed={() => void markUsed(row.subscription.id)} onEdit={() => setEditing({ kind: 'edit', id: row.subscription.id })} />)}

    <Pressable accessibilityRole="button" accessibilityLabel="구독 추가" style={styles.addButton} onPress={() => { setError(''); setEditing({ kind: 'new' }); }}>
      <Text style={styles.addText}>+ 구독 추가</Text>
    </Pressable>
  </View>;
}

function Row({ row, busy, onUsed, onEdit }: { row: SubscriptionRow; busy: boolean; onUsed: () => void; onEdit: () => void }) {
  const { subscription: s } = row;
  const idle = row.usedToday ? '오늘 사용' : row.idleDays === null ? '사용 기록 없음' : row.idleDays === 0 ? '오늘 등록' : `마지막 사용 ${row.idleDays}일 전`;
  return <View style={[styles.row, row.cancelCandidate ? styles.rowCandidate : null]}>
    <View style={styles.rowTop}>
      <Text style={styles.rowName} numberOfLines={2}>{s.name}</Text>
      <Text style={styles.rowAmount}>{formatWon(row.monthlyAmountKrw)}<Text style={styles.rowAmountUnit}> /월</Text></Text>
    </View>
    <Text style={styles.rowMeta}>
      {SCOPE_LABEL[s.scope]} · {CYCLE_LABEL[s.cycle]} {formatWon(s.amountKrw)} · 다음 결제 {shortDate(row.nextPayment)} ({dayLabel(row.daysToPayment)})
    </Text>
    <Text style={[styles.rowMeta, row.cancelCandidate ? styles.candidateText : null]}>{row.cancelCandidate ? `해지 후보 · ${idle}` : idle}</Text>
    <View style={styles.rowActions}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${s.name} 오늘 사용함으로 기록`} disabled={busy || row.usedToday} style={[styles.rowButton, row.usedToday ? styles.rowButtonDone : null]} onPress={onUsed}>
        <Text style={styles.rowButtonText}>{row.usedToday ? '✓ 오늘 썼음' : busy ? '저장 중…' : '오늘 썼음'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`${s.name} 수정`} disabled={busy} style={styles.rowButton} onPress={onEdit}><Text style={styles.rowButtonText}>수정</Text></Pressable>
    </View>
  </View>;
}

const c = mobileTheme.colors;
const styles = StyleSheet.create({
  root: { gap: 12 },
  summaryCard: { backgroundColor: c.primary, borderRadius: mobileTheme.radius.card, padding: mobileTheme.spacing.card, gap: 4 },
  summaryLabel: { color: '#cbd5e1', fontSize: 13 },
  summaryAmount: { color: c.primaryText, fontSize: 32, fontWeight: '800' },
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
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  rowName: { flex: 1, fontSize: 17, fontWeight: '700', color: c.text },
  rowAmount: { fontSize: 17, fontWeight: '700', color: c.text },
  rowAmountUnit: { fontSize: 12, fontWeight: '400', color: c.textMuted },
  rowMeta: { fontSize: 13, color: c.textSecondary, lineHeight: 19 },
  candidateText: { color: c.danger, fontWeight: '600' },
  rowActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  rowButton: { flex: 1, minHeight: mobileTheme.size.touchTarget, borderRadius: mobileTheme.radius.control, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface },
  rowButtonDone: { backgroundColor: c.neutralBackground },
  rowButtonText: { fontSize: 15, color: c.text },
  addButton: { minHeight: mobileTheme.size.touchTarget, borderRadius: mobileTheme.radius.control, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  addText: { color: c.primaryText, fontSize: 16, fontWeight: '700' },
});
