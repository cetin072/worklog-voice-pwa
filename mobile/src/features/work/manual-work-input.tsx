import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

import { mobileTheme } from '@/src/ui/theme';

export type ManualWorkInputValue = Readonly<{
  transcript: string;
  institution: string;
  status: string;
  type: string;
  amount: string;
  assignee: string;
  dueDate: string;
  dueTime?: string;
  followUp: string;
}>;

type Props = Readonly<{
  value: ManualWorkInputValue;
  busy: boolean;
  onChange(next: ManualWorkInputValue): void;
  onSave(): void;
}>;

function dateValue(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return new Date();
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 9, 0);
}

function timeValue(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  const date = new Date();
  if (match) date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return date;
}

function dateText(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function timeText(value: Date) {
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
}

function dateLabel(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${Number(match[1])}. ${Number(match[2])}. ${Number(match[3])}.` : '날짜 선택';
}

function timeLabel(value?: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value || '');
  if (!match) return '시간 선택';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const period = hour < 12 ? '오전' : '오후';
  const displayHour = hour % 12 || 12;
  return `${period} ${displayHour}:${String(minute).padStart(2, '0')}`;
}

export function ManualWorkInput({ value, busy, onChange, onSave }: Props) {
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const update = (patch: Partial<ManualWorkInputValue>) => onChange({ ...value, ...patch });

  return <View style={styles.root}>
    <View style={styles.field}>
      <Text style={styles.label}>입력</Text>
      <TextInput
        accessibilityLabel="업무 내용"
        editable={!busy}
        multiline
        placeholder="업무 내용을 입력하세요"
        style={[styles.input, styles.transcript]}
        value={value.transcript}
        onChangeText={(transcript) => update({ transcript })}
        textAlignVertical="top"
      />
    </View>

    <View style={styles.field}>
      <Text style={styles.label}>날짜</Text>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel="날짜 선택" disabled={busy} style={[styles.select, busy ? styles.disabled : null]} onPress={() => { setShowTimePicker(false); setShowDatePicker(true); }}>
          <Text style={[styles.selectText, value.dueDate ? null : styles.placeholder]}>{dateLabel(value.dueDate)}</Text>
        </Pressable>
        {value.dueDate ? <Pressable accessibilityRole="button" disabled={busy} style={styles.clear} onPress={() => { setShowDatePicker(false); update({ dueDate: '', dueTime: '' }); }}><Text style={styles.clearText}>지우기</Text></Pressable> : null}
      </View>
      {showDatePicker ? <View style={styles.pickerBox}>
        <DateTimePicker value={dateValue(value.dueDate)} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'} locale="ko-KR" onChange={(_, selected) => {
          if (Platform.OS === 'android') setShowDatePicker(false);
          if (selected) update({ dueDate: dateText(selected) });
        }} />
        {Platform.OS === 'ios' ? <Pressable accessibilityRole="button" style={styles.pickerDone} onPress={() => setShowDatePicker(false)}><Text style={styles.pickerDoneText}>선택 완료</Text></Pressable> : null}
      </View> : null}
    </View>

    <View style={styles.field}>
      <Text style={styles.label}>시간</Text>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel="시간 선택" disabled={busy} style={[styles.select, busy ? styles.disabled : null]} onPress={() => { setShowDatePicker(false); setShowTimePicker(true); }}>
          <Text style={[styles.selectText, value.dueTime ? null : styles.placeholder]}>{timeLabel(value.dueTime)}</Text>
        </Pressable>
        {value.dueTime ? <Pressable accessibilityRole="button" disabled={busy} style={styles.clear} onPress={() => { setShowTimePicker(false); update({ dueTime: '' }); }}><Text style={styles.clearText}>지우기</Text></Pressable> : null}
      </View>
      {showTimePicker ? <View style={styles.pickerBox}>
        <DateTimePicker value={timeValue(value.dueTime || '')} mode="time" display={Platform.OS === 'ios' ? 'spinner' : 'default'} locale="ko-KR" onChange={(_, selected) => {
          if (Platform.OS === 'android') setShowTimePicker(false);
          if (selected) update({ dueTime: timeText(selected) });
        }} />
        {Platform.OS === 'ios' ? <Pressable accessibilityRole="button" style={styles.pickerDone} onPress={() => setShowTimePicker(false)}><Text style={styles.pickerDoneText}>선택 완료</Text></Pressable> : null}
      </View> : null}
    </View>

    <Pressable accessibilityRole="button" disabled={busy || !value.transcript.trim()} style={[styles.save, busy || !value.transcript.trim() ? styles.disabled : null]} onPress={onSave}>
      <Text style={styles.saveText}>{busy ? '저장 중…' : '저장'}</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 16 },
  field: { gap: 7 },
  label: { fontSize: 13, fontWeight: '800', color: mobileTheme.colors.textSecondary },
  input: { minHeight: mobileTheme.size.input, borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: mobileTheme.radius.control, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: mobileTheme.colors.text, backgroundColor: mobileTheme.colors.surface },
  transcript: { minHeight: 132 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  select: { flex: 1, minHeight: mobileTheme.size.input, justifyContent: 'center', borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: mobileTheme.radius.control, paddingHorizontal: 14, backgroundColor: mobileTheme.colors.surface },
  selectText: { fontSize: 16, color: mobileTheme.colors.text },
  placeholder: { color: mobileTheme.colors.textMuted },
  clear: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  clearText: { color: mobileTheme.colors.link, fontSize: 12, fontWeight: '800' },
  pickerBox: { borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: mobileTheme.radius.control, overflow: 'hidden', backgroundColor: mobileTheme.colors.surface },
  pickerDone: { minHeight: 42, alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderTopColor: mobileTheme.colors.border },
  pickerDoneText: { color: mobileTheme.colors.link, fontSize: 13, fontWeight: '800' },
  save: { minHeight: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: mobileTheme.colors.primary },
  saveText: { color: mobileTheme.colors.primaryText, fontSize: 16, fontWeight: '900' },
  disabled: { opacity: 0.5 },
});
