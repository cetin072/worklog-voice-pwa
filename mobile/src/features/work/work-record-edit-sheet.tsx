import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

import { mobileTheme } from '@/src/ui/theme';

type WorkRecordEditSheetProps = Readonly<{
  visible: boolean;
  title: string;
  date: string;
  time: string;
  loading: boolean;
  saving: boolean;
  ready: boolean;
  statusText?: string;
  onTitle(value: string): void;
  onDate(value: string): void;
  onTime(value: string): void;
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
  statusText = '',
  onTitle,
  onDate,
  onTime,
  onSave,
  onCancel,
  onRetry,
}: WorkRecordEditSheetProps) {
  const titleInput = useRef<TextInput>(null);
  const [pickerMode, setPickerMode] = useState<'date' | 'time' | null>(null);
  const busy = loading || saving;

  useEffect(() => {
    if (!visible) {
      setPickerMode(null);
      return;
    }
    if (!ready || busy) return;
    const timer = setTimeout(() => titleInput.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, [visible, ready, busy]);

  function close() {
    if (busy) return;
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
      <Pressable accessibilityLabel="업무 수정 닫기" style={StyleSheet.absoluteFill} disabled={busy} onPress={close} />
      <View style={styles.sheet} accessibilityViewIsModal>
        <View style={styles.head}>
          <View style={styles.headCopy}>
            <Text style={styles.eyebrow}>업무 수정</Text>
            <Text style={styles.title}>브리핑 내용을 바로 고칩니다</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="업무 수정 닫기" hitSlop={8} disabled={busy} style={styles.close} onPress={close}>
            <Text style={styles.closeText}>×</Text>
          </Pressable>
        </View>

        {loading ? <View style={styles.loading}><ActivityIndicator /><Text style={styles.status}>현재 업무 정보를 불러오는 중입니다.</Text></View> : null}

        <Text style={styles.label}>업무명</Text>
        <TextInput
          ref={titleInput}
          accessibilityLabel="수정할 업무명"
          autoCorrect
          editable={ready && !busy}
          maxLength={160}
          placeholder="업무명"
          selectTextOnFocus
          style={[styles.input, !ready || busy ? styles.disabled : null]}
          value={title}
          onChangeText={onTitle}
        />

        <View style={styles.dateRow}>
          <View style={styles.field}>
            <Text style={styles.label}>날짜</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="수정할 날짜 선택"
              disabled={!ready || busy}
              style={[styles.pickerTrigger, !ready || busy ? styles.disabled : null]}
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
              disabled={!ready || busy || !date}
              style={[styles.pickerTrigger, !ready || busy || !date ? styles.disabled : null]}
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
          <Text style={styles.help}>{date ? '날짜와 시간은 터치해서 바꿉니다.' : '현재 기한 없음 · 날짜를 선택하면 기한이 생깁니다.'}</Text>
          {date || time ? <Pressable accessibilityRole="button" accessibilityLabel="기한 없음으로 변경" disabled={!ready || busy} onPress={() => { setPickerMode(null); onDate(''); onTime(''); }}><Text style={styles.clearDue}>기한 없음</Text></Pressable> : null}
        </View>
        <Text style={styles.help}>업무명과 기한만 수정하며, 음성 원문은 그대로 보존됩니다.</Text>

        {statusText ? <Text accessibilityLiveRegion="polite" style={styles.status}>{statusText}</Text> : null}
        {!ready && !loading && onRetry ? <Pressable accessibilityRole="button" style={styles.retry} onPress={onRetry}><Text style={styles.retryText}>다시 불러오기</Text></Pressable> : null}

        <View style={styles.actions}>
          <Pressable accessibilityRole="button" disabled={busy} style={[styles.secondary, busy ? styles.disabled : null]} onPress={close}><Text style={styles.secondaryText}>취소</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={!ready || busy || !title.trim()} style={[styles.primary, !ready || busy || !title.trim() ? styles.disabled : null]} onPress={onSave}><Text style={styles.primaryText}>{saving ? '저장 중…' : '저장'}</Text></Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(17,24,39,0.42)' },
  sheet: { gap: 10, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 18, backgroundColor: mobileTheme.colors.surface, borderWidth: 1, borderColor: mobileTheme.colors.border },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headCopy: { flex: 1, minWidth: 0, gap: 2 },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 0.9, color: mobileTheme.colors.textMuted },
  title: { fontSize: 17, fontWeight: '800', color: mobileTheme.colors.text },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  closeText: { fontSize: 28, lineHeight: 30, color: mobileTheme.colors.textSecondary },
  loading: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 9 },
  label: { fontSize: 12, fontWeight: '800', color: mobileTheme.colors.textSecondary },
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
  status: { fontSize: 13, color: mobileTheme.colors.textSecondary, lineHeight: 19 },
  retry: { minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: mobileTheme.colors.border, backgroundColor: mobileTheme.colors.surface },
  retryText: { fontSize: 13, fontWeight: '800', color: mobileTheme.colors.link },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingTop: 2 },
  secondary: { minHeight: 44, minWidth: 86, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: mobileTheme.colors.border, backgroundColor: mobileTheme.colors.surface },
  secondaryText: { color: mobileTheme.colors.textSecondary, fontSize: 13, fontWeight: '800' },
  primary: { minHeight: 44, minWidth: 96, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: mobileTheme.colors.primary },
  primaryText: { color: mobileTheme.colors.primaryText, fontSize: 13, fontWeight: '800' },
  disabled: { opacity: 0.5 },
});
