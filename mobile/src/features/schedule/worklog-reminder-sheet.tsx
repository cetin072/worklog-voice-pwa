import { useEffect, useRef, useState } from 'react';
import { Button, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { mobileTheme } from '@/src/ui/theme';
import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import type { ConfirmedSchedule } from './schedule-reminder-coordinator';
import { findWorklogReminder, confirmWorklogReminder, type ReminderTarget } from './worklog-reminder-adapter';
import { confirmedSeoulInstant, reminderFailureMessage } from './reminder-feedback';
import { reserveConfirmedReminder } from './schedule-reminder-post-save';
import { reminderSessionEpoch, reminderSyncEpoch } from './schedule-reminder-snapshot';
import { listScheduleReminders, openExactAlarmPermissionSettings } from './local-notifications';

function pickerValue(date: string, time: string) {
  const matchDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const matchTime = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  const now = new Date();
  if (!matchDate) return now;
  return new Date(
    Number(matchDate[1]), Number(matchDate[2]) - 1, Number(matchDate[3]),
    matchTime ? Number(matchTime[1]) : now.getHours(),
    matchTime ? Number(matchTime[2]) : now.getMinutes(),
  );
}

function calendarDate(value: Date) {
  return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, '0'), String(value.getDate()).padStart(2, '0')].join('-');
}

function calendarTime(value: Date) {
  return [String(value.getHours()).padStart(2, '0'), String(value.getMinutes()).padStart(2, '0')].join(':');
}

/** Explicit confirmation never edits a record's kind, deadline or original text. */
export function WorklogReminderSheet({ client, target, onClose }: { client: PlatformSupabaseClient; target: ReminderTarget; onClose(): void }) {
  const [schedule, setSchedule] = useState<ConfirmedSchedule | null>(null);
  const [reload, setReload] = useState(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [pickerMode, setPickerMode] = useState<'date' | 'time' | null>(null);
  const [message, setMessage] = useState('일정과 알림을 확인하는 중…');
  const gate = useRef(false);
  const alive = useRef(true);
  const guard = useRef(reminderSessionEpoch.capture());
  useEffect(() => {
    let active = true;
    alive.current = true;
    guard.current = reminderSessionEpoch.capture();
    const current = () => active && alive.current && guard.current();
    void findWorklogReminder(client, target, current).then(async (found) => {
      const reminders = found ? await listScheduleReminders(found.id) : [];
      if (!current()) return;
      setSchedule(found); setReady(true);
      // Stored mappings are not proof of a current OS reservation: the action below verifies it.
      setMessage(found ? `저장된 알림 ${reminders.length}개 · 아래 버튼으로 이 기기 예약을 확인하거나 추가하세요.` : '알림을 만들려면 날짜와 시간을 확인해주세요. 기록의 종류와 기한은 바뀌지 않습니다.');
    }).catch((error) => { if (current()) setMessage(reminderFailureMessage(error)); });
    return () => { active = false; alive.current = false; };
  }, [client, target, reload]);

  async function reserve(offsetMinutes: 0 | 30 | 1440) {
    if (gate.current || !ready) return;
    gate.current = true; setBusy(true);
    const epoch = reminderSyncEpoch.begin();
    const current = () => alive.current && guard.current() && epoch();
    try {
      let canonical = schedule;
      if (!canonical) {
        const startsAt = confirmedSeoulInstant(date.trim(), time.trim());
        if (Date.parse(startsAt) - offsetMinutes * 60000 <= Date.now()) throw new Error('TIME_INVALID');
        canonical = await confirmWorklogReminder(client, target.recordId || '', startsAt, current);
      } else canonical = await findWorklogReminder(client, { ...target, scheduleId: canonical.id }, current);
      if (!canonical || canonical.status !== 'confirmed') throw new Error('REMINDER_INACTIVE');
      if (canonical.allDay || !canonical.startsAt) throw new Error('TIME_REQUIRED');
      if (current()) setSchedule(canonical);
      if (Date.parse(canonical.startsAt) - offsetMinutes * 60000 <= Date.now()) throw new Error('TIME_INVALID');
      await reserveConfirmedReminder(canonical, offsetMinutes, current);
      if (current()) setMessage(`일정 저장 · 이 기기 ${offsetMinutes === 0 ? '시작 시' : offsetMinutes === 30 ? '30분 전' : '1일 전'} 알림 예약 확인 완료`);
    } catch (error) { if (alive.current && guard.current()) setMessage(reminderFailureMessage(error)); }
    finally { gate.current = false; if (alive.current) setBusy(false); }
  }
  return <Modal visible animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>
    <ScrollView contentContainerStyle={{ padding: 24, gap: 16, paddingTop: 60 }}>
      <Text style={{ fontSize: 24, fontWeight: '700' }}>알림 설정</Text>
      <Text>{target.title}</Text>
      {schedule ? <Text>일정 시각: {schedule.startsAt ? new Date(schedule.startsAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '미정'} (한국 시간)</Text> : ready ? <View style={{ gap: 12 }}>
        <Text>이 기록에는 확정된 일정 시각이 없습니다. 아래에서 날짜와 시간을 터치해 선택하세요. 한국 시간(Asia/Seoul) 기준입니다.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="알림 날짜 선택" disabled={busy} style={[styles.pickerTrigger, busy ? styles.disabled : null]} onPress={() => setPickerMode('date')}>
          <Text style={[styles.pickerText, date ? null : styles.placeholder]}>{date || '날짜 선택'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="알림 시간 선택" disabled={busy || !date} style={[styles.pickerTrigger, busy || !date ? styles.disabled : null]} onPress={() => setPickerMode('time')}>
          <Text style={[styles.pickerText, time ? null : styles.placeholder]}>{time || '시간 선택'}</Text>
        </Pressable>
        {pickerMode ? <View>
          <DateTimePicker
            value={pickerValue(date, time)}
            mode={pickerMode}
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            locale="ko-KR"
            is24Hour
            onChange={(_, selected) => {
              if (Platform.OS === 'android') setPickerMode(null);
              if (!selected) return;
              if (pickerMode === 'date') setDate(calendarDate(selected));
              else setTime(calendarTime(selected));
            }}
          />
          {Platform.OS === 'ios' ? <Button title="선택 완료" onPress={() => setPickerMode(null)} /> : null}
        </View> : null}
      </View> : null}
      <Text accessibilityLiveRegion="polite">{message}</Text>
      {!ready ? <Button title="일정 다시 조회" onPress={() => setReload((value) => value + 1)} /> : null}
      <Text>확정 일정은 시작 시 자동 알림을 사용합니다. 30분 전·1일 전은 추가 예약입니다. 지난 시각은 예약하지 않습니다.</Text>
      {([0, 30, 1440] as const).map((offset) => <Button key={offset} disabled={busy || !ready || (!schedule && (!date || !time))} title={`${offset === 0 ? '시작 시' : offset === 30 ? '30분 전' : '1일 전'} 알림 확인 / 예약`} onPress={() => void reserve(offset)} />)}
      <Button title="휴대폰 알림 권한 설정" onPress={() => void Linking.openSettings().catch(() => setMessage('휴대폰 설정에서 업무수첩 QA 알림 권한을 확인해주세요.'))} />
      <Button title="정확한 알람 권한 설정" onPress={() => void openExactAlarmPermissionSettings().catch(() => setMessage('휴대폰 설정에서 정확한 알람 권한을 확인해주세요.'))} />
      <Button title="닫기 / 확인 취소" disabled={busy} onPress={onClose} />
    </ScrollView>
  </Modal>;
}

const styles = StyleSheet.create({
  pickerTrigger: { minHeight: 50, justifyContent: 'center', paddingHorizontal: 14, borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: 12, backgroundColor: mobileTheme.colors.surface },
  pickerText: { fontSize: 16, color: mobileTheme.colors.text },
  placeholder: { color: mobileTheme.colors.textMuted },
  disabled: { opacity: 0.5 },
});
