import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

import { mobileTheme } from '@/src/ui/theme';

type Props = Readonly<{
  busy?: boolean;
  hasAttention?: boolean;
  onPostpone(date: string): void;
  onAttention(date: string): void;
  onClearAttention(): void;
}>;

type PickerAction = 'postpone' | 'attention' | null;

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function afterDays(days: number) {
  const next = new Date();
  next.setHours(9, 0, 0, 0);
  next.setDate(next.getDate() + days);
  return dateKey(next);
}

/** Secondary actions only: the primary home-row action remains completion. */
export function TaskReminderActions({ busy = false, hasAttention = false, onPostpone, onAttention, onClearAttention }: Props) {
  const [pickerAction, setPickerAction] = useState<PickerAction>(null);
  const [pickerDate, setPickerDate] = useState(() => new Date());

  function startPicker(action: Exclude<PickerAction, null>) {
    const initial = new Date();
    initial.setHours(9, 0, 0, 0);
    initial.setDate(initial.getDate() + 1);
    setPickerDate(initial);
    setPickerAction(action);
  }

  function pick(value?: Date) {
    if (!value || !pickerAction) return;
    const selected = dateKey(value);
    const action = pickerAction;
    if (Platform.OS === 'android') setPickerAction(null);
    if (action === 'postpone') onPostpone(selected);
    else onAttention(selected);
  }

  return <View style={styles.section}>
    <Text style={styles.title}>일정 조정</Text>
    <Text style={styles.help}>미루기는 기한을 바꾸고, 다시 알림은 기한을 유지합니다.</Text>
    <View style={styles.row}>
      <Pressable accessibilityRole="button" disabled={busy} style={[styles.action, busy ? styles.disabled : null]} onPress={() => onPostpone(afterDays(1))}><Text style={styles.actionText}>내일로 미루기</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy} style={[styles.action, busy ? styles.disabled : null]} onPress={() => onPostpone(afterDays(7))}><Text style={styles.actionText}>다음주로 미루기</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy} style={[styles.action, busy ? styles.disabled : null]} onPress={() => startPicker('postpone')}><Text style={styles.actionText}>직접 선택</Text></Pressable>
    </View>
    <Text style={styles.title}>다시 알림</Text>
    <View style={styles.row}>
      <Pressable accessibilityRole="button" disabled={busy} style={[styles.action, busy ? styles.disabled : null]} onPress={() => onAttention(afterDays(1))}><Text style={styles.actionText}>내일</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy} style={[styles.action, busy ? styles.disabled : null]} onPress={() => onAttention(afterDays(7))}><Text style={styles.actionText}>다음주</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy} style={[styles.action, busy ? styles.disabled : null]} onPress={() => startPicker('attention')}><Text style={styles.actionText}>직접 선택</Text></Pressable>
      {hasAttention ? <Pressable accessibilityRole="button" disabled={busy} style={[styles.clear, busy ? styles.disabled : null]} onPress={onClearAttention}><Text style={styles.clearText}>다시 알림 취소</Text></Pressable> : null}
    </View>
    {pickerAction ? <View style={styles.picker}><Text style={styles.help}>{pickerAction === 'postpone' ? '미룰 날짜' : '다시 확인할 날짜'}를 선택하세요. 기존 기한 시간이 있으면 유지됩니다.</Text><DateTimePicker value={pickerDate} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'} locale="ko-KR" onChange={(_, value) => { if (Platform.OS === 'ios') { if (value) setPickerDate(value); } else pick(value); }} />{Platform.OS === 'ios' ? <Pressable accessibilityRole="button" style={styles.done} onPress={() => { const selected = dateKey(pickerDate); const action = pickerAction; setPickerAction(null); if (action === 'postpone') onPostpone(selected); else onAttention(selected); }}><Text style={styles.doneText}>선택 완료</Text></Pressable> : null}</View> : null}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 8, paddingTop: 16, borderTopWidth: 1, borderTopColor: mobileTheme.colors.border },
  title: { fontSize: 15, fontWeight: '900', color: mobileTheme.colors.text },
  help: { fontSize: 12, lineHeight: 18, color: mobileTheme.colors.textMuted },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 11, borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: 11, backgroundColor: mobileTheme.colors.surface },
  actionText: { fontSize: 12, fontWeight: '800', color: mobileTheme.colors.link },
  clear: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 11, borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: 11 },
  clearText: { fontSize: 12, fontWeight: '800', color: mobileTheme.colors.textSecondary },
  picker: { gap: 6, borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: 12, padding: 8 },
  done: { minHeight: 40, alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderTopColor: mobileTheme.colors.border },
  doneText: { color: mobileTheme.colors.link, fontSize: 13, fontWeight: '800' },
  disabled: { opacity: 0.5 },
});
