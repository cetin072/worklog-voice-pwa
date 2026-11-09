import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

import { mobileTheme } from '@/src/ui/theme';
import {
  CYCLE_LABEL,
  SCOPE_LABEL,
  parseDateKey,
  validateSubscriptionDraft,
  type BillingCycle,
  type Subscription,
  type SubscriptionDraft,
  type SubscriptionDraftErrors,
  type SubscriptionScope,
} from './subscription-model';
import type { SubscriptionInput } from './subscription-store';

const SCOPES: SubscriptionScope[] = ['business', 'personal'];
const CYCLES: BillingCycle[] = ['monthly', 'yearly'];

function keyToDate(key: string) {
  const p = parseDateKey(key);
  return p ? new Date(p.y, p.m - 1, p.d, 12) : new Date();
}
function dateToKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function draftFromSubscription(sub: Subscription | null, todayKey: string, defaultScope: SubscriptionScope): SubscriptionDraft {
  return sub
    ? { name: sub.name, amountText: String(sub.amountKrw), cycle: sub.cycle, scope: sub.scope, billingAnchorDate: sub.billingAnchorDate, cancelDeadline: sub.cancelDeadline || '' }
    : { name: '', amountText: '', cycle: 'monthly', scope: defaultScope, billingAnchorDate: todayKey, cancelDeadline: '' };
}

function DateField({ label, value, placeholder, optional, error, onChange }: {
  label: string; value: string; placeholder: string; optional?: boolean; error?: string; onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <View style={styles.dateRow}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label} 선택`} style={[styles.input, styles.dateButton]} onPress={() => setOpen(true)}>
        <Text style={value ? styles.inputText : styles.placeholder}>{value || placeholder}</Text>
      </Pressable>
      {optional && value ? <Pressable accessibilityRole="button" accessibilityLabel={`${label} 지우기`} style={styles.clearButton} onPress={() => onChange('')}><Text style={styles.clearText}>지우기</Text></Pressable> : null}
    </View>
    {open ? <>
      <DateTimePicker value={keyToDate(value)} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'} locale="ko-KR"
        onChange={(event, selected) => {
          if (event.type === 'dismissed') { setOpen(false); return; }
          if (!selected) return;
          onChange(dateToKey(selected));
          if (Platform.OS !== 'ios') setOpen(false);
        }} />
      {Platform.OS === 'ios' ? <Pressable accessibilityRole="button" style={styles.clearButton} onPress={() => setOpen(false)}><Text style={styles.clearText}>선택 완료</Text></Pressable> : null}
    </> : null}
    {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
  </View>;
}

function Choice<T extends string>({ label, options, value, labels, onChange }: { label: string; options: readonly T[]; value: T; labels: Record<T, string>; onChange: (next: T) => void }) {
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <View style={styles.choiceRow}>
      {options.map((option) => <Pressable key={option} accessibilityRole="button" accessibilityState={{ selected: value === option }} style={[styles.choice, value === option ? styles.choiceActive : null]} onPress={() => onChange(option)}>
        <Text style={value === option ? styles.choiceActiveText : styles.choiceText}>{labels[option]}</Text>
      </Pressable>)}
    </View>
  </View>;
}

export function SubscriptionForm({ initial, busy, isNew, onSave, onCancel, onDelete }: {
  initial: SubscriptionDraft; busy: boolean; isNew: boolean;
  onSave: (value: SubscriptionInput) => void; onCancel: () => void; onDelete?: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<SubscriptionDraftErrors>({});
  const set = <K extends keyof SubscriptionDraft>(key: K, value: SubscriptionDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  function submit() {
    const result = validateSubscriptionDraft(draft);
    if (!result.ok) { setErrors(result.errors); return; }
    setErrors({});
    onSave(result.value);
  }

  return <View style={styles.form}>
    <Text style={styles.formTitle}>{isNew ? '구독 추가' : '구독 수정'}</Text>
    <Choice label="구분" options={SCOPES} value={draft.scope} labels={SCOPE_LABEL} onChange={(v) => set('scope', v)} />
    <View style={styles.field}>
      <Text style={styles.label}>서비스 이름</Text>
      <TextInput accessibilityLabel="서비스 이름" style={styles.input} value={draft.name} maxLength={60} placeholder="예: 클라우드 저장공간" onChangeText={(v) => set('name', v)} />
      {errors.name ? <Text accessibilityLiveRegion="polite" style={styles.error}>{errors.name}</Text> : null}
    </View>
    <View style={styles.field}>
      <Text style={styles.label}>{draft.cycle === 'yearly' ? '1년 결제 금액(원)' : '1회 결제 금액(원)'}</Text>
      <TextInput accessibilityLabel="결제 금액" style={styles.input} value={draft.amountText} keyboardType="number-pad" placeholder="예: 12000" onChangeText={(v) => set('amountText', v)} />
      {errors.amount ? <Text accessibilityLiveRegion="polite" style={styles.error}>{errors.amount}</Text> : null}
    </View>
    <Choice label="결제 주기" options={CYCLES} value={draft.cycle} labels={CYCLE_LABEL} onChange={(v) => set('cycle', v)} />
    <DateField label="다음 결제일" value={draft.billingAnchorDate} placeholder="날짜 선택" error={errors.billingAnchorDate} onChange={(v) => set('billingAnchorDate', v)} />
    <DateField label="해지기한 (선택)" value={draft.cancelDeadline} placeholder="없으면 비워두세요" optional error={errors.cancelDeadline} onChange={(v) => set('cancelDeadline', v)} />
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" disabled={busy} style={[styles.primary, busy ? styles.disabled : null]} onPress={submit}><Text style={styles.primaryText}>{busy ? '저장 중…' : '저장'}</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={onCancel}><Text style={styles.secondaryText}>취소</Text></Pressable>
    </View>
    {onDelete ? <Pressable accessibilityRole="button" disabled={busy} style={styles.deleteButton} onPress={onDelete}><Text style={styles.deleteText}>이 구독 삭제</Text></Pressable> : null}
  </View>;
}

const c = mobileTheme.colors;
const styles = StyleSheet.create({
  form: { backgroundColor: c.surface, borderRadius: mobileTheme.radius.card, padding: mobileTheme.spacing.card, gap: 14 },
  formTitle: { fontSize: 18, fontWeight: '700', color: c.text },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: c.textSecondary },
  input: { minHeight: mobileTheme.size.input, borderWidth: 1, borderColor: c.border, borderRadius: mobileTheme.radius.control, paddingHorizontal: 12, fontSize: 16, color: c.text, justifyContent: 'center' },
  inputText: { fontSize: 16, color: c.text },
  placeholder: { fontSize: 16, color: c.textMuted },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateButton: { flex: 1 },
  clearButton: { minHeight: mobileTheme.size.touchTarget, paddingHorizontal: 12, justifyContent: 'center' },
  clearText: { color: c.link, fontSize: 14 },
  choiceRow: { flexDirection: 'row', gap: 8 },
  choice: { flex: 1, minHeight: mobileTheme.size.touchTarget, borderWidth: 1, borderColor: c.border, borderRadius: mobileTheme.radius.control, alignItems: 'center', justifyContent: 'center' },
  choiceActive: { backgroundColor: c.primary, borderColor: c.primary },
  choiceText: { color: c.text, fontSize: 15 },
  choiceActiveText: { color: c.primaryText, fontSize: 15, fontWeight: '600' },
  error: { color: c.danger, fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 8 },
  primary: { flex: 1, minHeight: mobileTheme.size.touchTarget, borderRadius: mobileTheme.radius.control, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: c.primaryText, fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  secondary: { minHeight: mobileTheme.size.touchTarget, paddingHorizontal: 20, borderRadius: mobileTheme.radius.control, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: c.text, fontSize: 16 },
  deleteButton: { minHeight: mobileTheme.size.touchTarget, alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: c.danger, fontSize: 15 },
});
