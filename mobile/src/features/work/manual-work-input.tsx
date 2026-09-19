import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

import { mobileTheme } from '@/src/ui/theme';

export const MANUAL_INSTITUTIONS = ['태장', '미래여성가족진흥원', '기타'] as const;
export const MANUAL_STATUSES = ['완료', '진행중', '대기', '확인필요'] as const;
export const MANUAL_TYPES = ['완료업무', '할 일', '회의·통화', '지출·세무', '지시·위임', '아이디어', '문제·확인', '기타'] as const;

export type ManualWorkInputValue = Readonly<{
  transcript: string;
  institution: string;
  status: string;
  type: string;
  amount: string;
  assignee: string;
  dueDate: string;
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

function dateText(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function dateLabel(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${Number(match[1])}. ${Number(match[2])}. ${Number(match[3])}.` : '날짜 선택';
}

function ChoiceGroup({ label, values, selected, disabled, onSelect }: { label: string; values: readonly string[]; selected: string; disabled: boolean; onSelect(value: string): void }) {
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <View style={styles.choices}>
      {values.map((value) => <Pressable
        key={value}
        accessibilityRole="button"
        accessibilityState={{ selected: selected === value }}
        disabled={disabled}
        style={[styles.choice, selected === value ? styles.choiceSelected : null, disabled ? styles.disabled : null]}
        onPress={() => onSelect(value)}
      >
        <Text style={[styles.choiceText, selected === value ? styles.choiceTextSelected : null]}>{selected === value ? '✓ ' : ''}{value}</Text>
      </Pressable>)}
    </View>
  </View>;
}

export function ManualWorkInput({ value, busy, onChange, onSave }: Props) {
  const [showDatePicker, setShowDatePicker] = useState(false);
  const update = (patch: Partial<ManualWorkInputValue>) => onChange({ ...value, ...patch });

  return <View style={styles.root}>
    <View style={styles.field}>
      <Text style={styles.label}>업무 내용</Text>
      <TextInput
        accessibilityLabel="업무 내용"
        multiline
        placeholder="예: 내일 오후 3시 김과장에게 계약서 확인 전화"
        style={[styles.input, styles.transcript]}
        value={value.transcript}
        onChangeText={(transcript) => update({ transcript })}
        textAlignVertical="top"
      />
    </View>

    <ChoiceGroup label="기관" values={MANUAL_INSTITUTIONS} selected={value.institution} disabled={busy} onSelect={(institution) => update({ institution })} />
    <ChoiceGroup label="상태" values={MANUAL_STATUSES} selected={value.status} disabled={busy} onSelect={(status) => update({ status })} />
    <ChoiceGroup label="유형" values={MANUAL_TYPES} selected={value.type} disabled={busy} onSelect={(type) => update({ type })} />

    <View style={styles.twoColumns}>
      <View style={styles.column}>
        <Text style={styles.label}>금액</Text>
        <TextInput
          accessibilityLabel="금액"
          editable={!busy}
          keyboardType="decimal-pad"
          placeholder="선택"
          style={styles.input}
          value={value.amount}
          onChangeText={(amount) => update({ amount })}
        />
      </View>
      <View style={styles.column}>
        <Text style={styles.label}>담당자</Text>
        <TextInput
          accessibilityLabel="담당자"
          editable={!busy}
          placeholder="선택"
          style={styles.input}
          value={value.assignee}
          onChangeText={(assignee) => update({ assignee })}
        />
      </View>
    </View>

    <View style={styles.field}>
      <Text style={styles.label}>기한</Text>
      <View style={styles.dueRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="기한 날짜 선택"
          disabled={busy}
          style={[styles.dateButton, busy ? styles.disabled : null]}
          onPress={() => setShowDatePicker((current) => !current)}
        >
          <Text style={[styles.dateButtonText, value.dueDate ? null : styles.placeholder]}>{dateLabel(value.dueDate)}</Text>
        </Pressable>
        {value.dueDate ? <Pressable accessibilityRole="button" disabled={busy} style={styles.clearDue} onPress={() => { setShowDatePicker(false); update({ dueDate: '' }); }}><Text style={styles.clearDueText}>기한 없음</Text></Pressable> : null}
      </View>
      {showDatePicker ? <View style={styles.pickerBox}>
        <DateTimePicker
          value={dateValue(value.dueDate)}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          locale="ko-KR"
          onChange={(_, selected) => {
            if (Platform.OS === 'android') setShowDatePicker(false);
            if (selected) update({ dueDate: dateText(selected) });
          }}
        />
        {Platform.OS === 'ios' ? <Pressable accessibilityRole="button" style={styles.pickerDone} onPress={() => setShowDatePicker(false)}><Text style={styles.pickerDoneText}>선택 완료</Text></Pressable> : null}
      </View> : null}
    </View>

    <View style={styles.field}>
      <Text style={styles.label}>후속조치</Text>
      <TextInput
        accessibilityLabel="후속조치"
        editable={!busy}
        multiline
        placeholder="예: 다음 주 재확인"
        style={[styles.input, styles.followUp]}
        value={value.followUp}
        onChangeText={(followUp) => update({ followUp })}
        textAlignVertical="top"
      />
    </View>

    <Text style={styles.help}>필요한 항목만 바꾸면 됩니다. 입력한 값은 업무 원문과 함께 저장됩니다.</Text>
    <Pressable
      accessibilityRole="button"
      disabled={busy || !value.transcript.trim()}
      style={[styles.save, busy || !value.transcript.trim() ? styles.disabled : null]}
      onPress={onSave}
    >
      <Text style={styles.saveText}>{busy ? '저장 중…' : '업무 저장'}</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 16 },
  field: { gap: 7 },
  label: { fontSize: 13, fontWeight: '800', color: mobileTheme.colors.textSecondary },
  input: { minHeight: mobileTheme.size.input, borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: mobileTheme.radius.control, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: mobileTheme.colors.text, backgroundColor: mobileTheme.colors.surface },
  transcript: { minHeight: 132 },
  followUp: { minHeight: 84 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: mobileTheme.radius.pill, backgroundColor: mobileTheme.colors.surface },
  choiceSelected: { backgroundColor: '#eef2f7', borderColor: mobileTheme.colors.primary },
  choiceText: { fontSize: 13, fontWeight: '700', color: mobileTheme.colors.textSecondary },
  choiceTextSelected: { color: mobileTheme.colors.text, fontWeight: '900' },
  twoColumns: { flexDirection: 'row', gap: 10 },
  column: { flex: 1, gap: 7 },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateButton: { flex: 1, minHeight: mobileTheme.size.input, justifyContent: 'center', borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: mobileTheme.radius.control, paddingHorizontal: 14, backgroundColor: mobileTheme.colors.surface },
  dateButtonText: { fontSize: 16, color: mobileTheme.colors.text },
  placeholder: { color: mobileTheme.colors.textMuted },
  clearDue: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  clearDueText: { color: mobileTheme.colors.link, fontSize: 12, fontWeight: '800' },
  pickerBox: { borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: mobileTheme.radius.control, overflow: 'hidden', backgroundColor: mobileTheme.colors.surface },
  pickerDone: { minHeight: 42, alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderTopColor: mobileTheme.colors.border },
  pickerDoneText: { color: mobileTheme.colors.link, fontSize: 13, fontWeight: '800' },
  help: { fontSize: 12, color: mobileTheme.colors.textMuted, lineHeight: 18 },
  save: { minHeight: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: mobileTheme.colors.primary },
  saveText: { color: mobileTheme.colors.primaryText, fontSize: 16, fontWeight: '900' },
  disabled: { opacity: 0.5 },
});
