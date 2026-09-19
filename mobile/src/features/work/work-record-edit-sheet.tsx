import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { mobileTheme } from '@/src/ui/theme';

type WorkRecordEditSheetProps = Readonly<{
  visible: boolean;
  title: string;
  date: string;
  time: string;
  loading: boolean;
  saving: boolean;
  ready: boolean;
  actionKind?: 'task' | 'note';
  actionConversionAllowed?: boolean;
  statusText?: string;
  statusTone?: 'neutral' | 'success' | 'error';
  onTitle(value: string): void;
  onDate(value: string): void;
  onTime(value: string): void;
  onActionKind?(value: 'task' | 'note'): void;
  onSave(): void;
  onCancel(): void;
  onRetry?(): void;
}>;

function pickerValue(date: string, time: string) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch) return new Date();
  return new Date(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    timeMatch ? Number(timeMatch[1]) : 9,
    timeMatch ? Number(timeMatch[2]) : 0,
  );
}

function pickerDateValue(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function pickerTimeValue(value: Date) {
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
}

function dateLabel(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return '날짜 선택';
  return `${Number(match[1])}. ${Number(match[2])}. ${Number(match[3])}.`;
}

export function WorkRecordEditSheet({
  visible,
  title,
  date,
  time,
  loading,
  saving,
  ready,
  actionKind,
  actionConversionAllowed = false,
  statusText = '',
  statusTone = 'neutral',
  onTitle,
  onDate,
  onTime,
  onActionKind,
  onSave,
  onCancel,
  onRetry,
}: WorkRecordEditSheetProps) {
  const insets = useSafeAreaInsets();
  const titleInput = useRef<TextInput>(null);
  const [pickerMode, setPickerMode] = useState<'date' | 'time' | null>(null);
  const inputBlocked = loading || saving;

  useEffect(() => {
    if (!visible) {
      setPickerMode(null);
      return;
    }
    if (!ready || inputBlocked) return;
    const timer = setTimeout(() => titleInput.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, [visible, ready, inputBlocked]);

  function close() {
    if (saving) return;
    setPickerMode(null);
    onCancel();
  }

  function selectDateTime(value?: Date) {
    if (!value) return;
    if (pickerMode === 'date') {
      onDate(pickerDateValue(value));
      return;
    }
    if (pickerMode === 'time') onTime(pickerTimeValue(value));
  }

  return <Modal
    animationType="slide"
    transparent
    visible={visible}
    statusBarTranslucent
    onRequestClose={close}
  >
    <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Pressable accessibilityLabel="업무 수정 닫기" style={StyleSheet.absoluteFill} disabled={saving} onPress={close} />
      <View style={[styles.sheet, { paddingBottom: 18 + insets.bottom }]} accessibilityViewIsModal>
        <View style={styles.dragHandle} />
        <View style={styles.head}>
          <View style={styles.headCopy}>
            <Text style={styles.title}>업무 수정</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="업무 수정 닫기" hitSlop={8} disabled={saving} style={styles.close} onPress={close}>
            <Text style={styles.closeText}>×</Text>
          </Pressable>
        </View>

        {loading ? <View style={styles.loading}><ActivityIndicator /><Text style={styles.status}>현재 업무 정보를 불러오는 중입니다.</Text></View> : null}

        <Text style={styles.label}>업무명</Text>
        <TextInput
          ref={titleInput}
          accessibilityLabel="수정할 업무명"
          autoCorrect
          editable={ready && !inputBlocked}
          maxLength={160}
          placeholder="업무명"
          selectTextOnFocus
          style={[styles.input, !ready || inputBlocked ? styles.disabled : null]}
          value={title}
          onChangeText={onTitle}
        />

        {actionKind ? <View style={styles.kindSection}>
          <Text style={styles.label}>종류</Text>
          <View style={styles.kindRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="할 일로 변경"
              disabled={!ready || inputBlocked || !actionConversionAllowed || !onActionKind}
              style={[styles.kindChoice, actionKind === 'task' ? styles.kindChoiceActive : null, !actionConversionAllowed ? styles.disabled : null]}
              onPress={() => onActionKind?.('task')}
            >
              <Text style={[styles.kindChoiceText, actionKind === 'task' ? styles.kindChoiceTextActive : null]}>할 일</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="메모 참고로 변경"
              disabled={!ready || inputBlocked || !actionConversionAllowed || !onActionKind}
              style={[styles.kindChoice, actionKind === 'note' ? styles.kindChoiceActive : null, !actionConversionAllowed ? styles.disabled : null]}
              onPress={() => onActionKind?.('note')}
            >
              <Text style={[styles.kindChoiceText, actionKind === 'note' ? styles.kindChoiceTextActive : null]}>메모 · 참고</Text>
            </Pressable>
          </View>
          <Text style={styles.help}>{actionConversionAllowed ? '종류를 바꾸면 저장할 때 함께 반영됩니다.' : '일정과 연결된 기록은 종류를 바꿀 수 없습니다.'}</Text>
        </View> : null}

        <View style={styles.dateRow}>
          <View style={styles.field}>
            <Text style={styles.label}>날짜</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="수정할 날짜 선택"
              disabled={!ready || inputBlocked}
              style={[styles.pickerTrigger, !ready || inputBlocked ? styles.disabled : null]}
              onPress={() => setPickerMode((current) => current === 'date' ? null : 'date')}
            >
              <Text style={[styles.pickerText, date ? null : styles.placeholder]}>{dateLabel(date)}</Text>
            </Pressable>
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>시간 <Text style={styles.optional}>선택</Text></Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="수정할 시간 선택"
              disabled={!ready || inputBlocked || !date}
              style={[styles.pickerTrigger, !ready || inputBlocked || !date ? styles.disabled : null]}
              onPress={() => setPickerMode((current) => current === 'time' ? null : 'time')}
            >
              <Text style={[styles.pickerText, time ? null : styles.placeholder]}>{time || '시간 선택'}</Text>
            </Pressable>
          </View>
        </View>

        {pickerMode && ready ? <View style={styles.pickerBox}>
          <DateTimePicker
            value={pickerValue(date, time)}
            mode={pickerMode}
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            locale="ko-KR"
            is24Hour
            onChange={(_, value) => {
              if (Platform.OS === 'android') setPickerMode(null);
              selectDateTime(value);
            }}
          />
          {Platform.OS === 'ios' ? <Pressable accessibilityRole="button" style={styles.pickerDone} onPress={() => setPickerMode(null)}><Text style={styles.pickerDoneText}>선택 완료</Text></Pressable> : null}
        </View> : null}

        <View style={styles.helpRow}>
          <Text style={styles.help}>{date ? '기한을 변경하거나 없앨 수 있습니다.' : '현재 기한 없음'}</Text>
          {date || time ? <Pressable accessibilityRole="button" accessibilityLabel="기한 없음으로 변경" disabled={!ready || inputBlocked} onPress={() => { setPickerMode(null); onDate(''); onTime(''); }}><Text style={styles.clearDue}>기한 없음</Text></Pressable> : null}
        </View>
        <Text style={styles.help}>음성 원문은 그대로 보존됩니다.</Text>

        {statusText ? <Text accessibilityLiveRegion="polite" style={[styles.status, statusTone === 'success' ? styles.statusSuccess : statusTone === 'error' ? styles.statusError : null]}>{statusText}</Text> : null}
        {!ready && !loading && onRetry ? <Pressable accessibilityRole="button" style={styles.retry} onPress={onRetry}><Text style={styles.retryText}>다시 불러오기</Text></Pressable> : null}

        <View style={styles.actions}>
          <Pressable accessibilityRole="button" disabled={saving} style={[styles.secondary, saving ? styles.disabled : null]} onPress={close}><Text style={styles.secondaryText}>취소</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={!ready || inputBlocked || !title.trim()} style={[styles.primary, !ready || inputBlocked || !title.trim() ? styles.disabled : null]} onPress={onSave}><Text style={styles.primaryText}>{saving ? '저장 중…' : statusTone === 'success' ? '✓ 저장 완료' : '저장'}</Text></Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(17,24,39,0.42)' },
  sheet: { gap: 10, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 18, backgroundColor: mobileTheme.colors.surface, borderWidth: 1, borderColor: mobileTheme.colors.border },
  dragHandle: { width: 44, height: 5, alignSelf: 'center', borderRadius: 999, backgroundColor: '#d1d5db', marginBottom: 2 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headCopy: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 19, fontWeight: '900', color: mobileTheme.colors.text },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  closeText: { fontSize: 28, lineHeight: 30, color: mobileTheme.colors.textSecondary },
  loading: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 9 },
  label: { fontSize: 12, fontWeight: '800', color: mobileTheme.colors.textSecondary },
  kindSection: { gap: 7 },
  kindRow: { flexDirection: 'row', gap: 8 },
  kindChoice: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: 12, backgroundColor: mobileTheme.colors.surface },
  kindChoiceActive: { borderColor: mobileTheme.colors.primary, backgroundColor: mobileTheme.colors.neutralBackground },
  kindChoiceText: { fontSize: 13, fontWeight: '800', color: mobileTheme.colors.textSecondary },
  kindChoiceTextActive: { color: mobileTheme.colors.primary },
  optional: { fontSize: 11, fontWeight: '700', color: mobileTheme.colors.textMuted },
  input: { minHeight: mobileTheme.size.input, borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: mobileTheme.radius.control, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: mobileTheme.colors.text, backgroundColor: mobileTheme.colors.surface },
  dateRow: { flexDirection: 'row', gap: 8 },
  field: { flex: 1, gap: 6 },
  pickerTrigger: { minHeight: mobileTheme.size.input, justifyContent: 'center', borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: mobileTheme.radius.control, paddingHorizontal: 14, backgroundColor: mobileTheme.colors.surface },
  pickerText: { fontSize: 16, color: mobileTheme.colors.text },
  placeholder: { color: mobileTheme.colors.textMuted },
  pickerBox: { borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: mobileTheme.radius.control, overflow: 'hidden', backgroundColor: mobileTheme.colors.surface },
  pickerDone: { minHeight: 40, alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderTopColor: mobileTheme.colors.border },
  pickerDoneText: { color: mobileTheme.colors.link, fontSize: 13, fontWeight: '800' },
  helpRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  help: { flexShrink: 1, fontSize: 12, color: mobileTheme.colors.textMuted, lineHeight: 18 },
  clearDue: { color: mobileTheme.colors.link, fontSize: 12, fontWeight: '800', paddingVertical: 6, paddingHorizontal: 4 },
  status: { minHeight: 22, fontSize: 13, fontWeight: '800', color: mobileTheme.colors.textSecondary, lineHeight: 19 },
  statusSuccess: { color: mobileTheme.colors.success },
  statusError: { color: mobileTheme.colors.danger },
  retry: { minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: mobileTheme.colors.border, backgroundColor: mobileTheme.colors.surface },
  retryText: { fontSize: 13, fontWeight: '800', color: mobileTheme.colors.link },
  actions: { flexDirection: 'row', gap: 10, paddingTop: 4 },
  secondary: { flex: 1, minHeight: 50, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: mobileTheme.colors.border, backgroundColor: mobileTheme.colors.surface },
  secondaryText: { color: mobileTheme.colors.textSecondary, fontSize: 13, fontWeight: '800' },
  primary: { flex: 1.2, minHeight: 50, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: mobileTheme.colors.primary },
  primaryText: { color: mobileTheme.colors.primaryText, fontSize: 13, fontWeight: '800' },
  disabled: { opacity: 0.5 },
});
