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
import { readScheduleReminderEvidence, openExactAlarmPermissionSettings } from './local-notifications';
import { reminderLabel, reminderPresentation, reminderOffsetReserved, type ReminderEvidence } from '../home/reminder-label';
import { readWorklogDetails } from '@/src/platform/worklog-api';
import { getFreshAccessToken } from '@/src/platform/authenticated-access';

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
  const [evidence, setEvidence] = useState<ReminderEvidence | null>(null);
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
      const nextEvidence = found ? await readScheduleReminderEvidence(found.id) : null;
      // Existing due fields are a hint for the picker, not evidence of a reserved OS alarm.
      let existingDue: { dueDate: string; dueTime: string } | null = null;
      if (!found && target.recordId) {
        try {
          const token = await getFreshAccessToken(client);
          existingDue = await readWorklogDetails(token, target.recordId);
        } catch { /* Legacy or offline record: keep manual picker usable. */ }
      }
      if (!current()) return;
      if (existingDue?.dueDate) setDate(existingDue.dueDate);
      if (existingDue?.dueTime) setTime(existingDue.dueTime);
      setSchedule(found); setEvidence(nextEvidence); setReady(true);
      // Stored mappings are not proof of a current OS reservation: the action below verifies it.
      setMessage(found ? '알림 예약 상태를 확인했습니다. 아래에서 시간을 선택해 설정할 수 있습니다.' : existingDue?.dueDate && existingDue?.dueTime
        ? '기존 기록의 날짜와 시간을 불러왔습니다. 시작 시 알림 등록을 누르면 이 기기에 예약합니다.'
        : '알림을 만들려면 날짜와 시간을 선택해주세요. 기록의 종류와 기한은 바뀌지 않습니다.');
    }).catch((error) => { if (current()) setMessage(reminderFailureMessage(error)); });
    return () => { active = false; alive.current = false; };
  }, [client, target, reload]);

  async function reserve(offsetMinutes: 0 | 30 | 1440) {
    if (gate.current || !ready) return;
    gate.current = true; setBusy(true); setEvidence(null);
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
      const nextEvidence = await readScheduleReminderEvidence(canonical.id);
      if (current()) setEvidence(nextEvidence);
      if (current()) setMessage(`일정 저장 · 이 기기 ${offsetMinutes === 0 ? '시작 시' : offsetMinutes === 30 ? '30분 전' : '1일 전'} 알림 예약 확인 완료`);
    } catch (error) { if (alive.current && guard.current()) setMessage(reminderFailureMessage(error)); }
    finally { gate.current = false; if (alive.current) setBusy(false); }
  }
  const label = schedule ? reminderLabel(schedule.id, evidence, Date.now(), schedule.startsAt) : ready ? '이 기기 알림 없음 · 설정' : '알림 확인 필요';
  const status = reminderPresentation(label);
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
      <View style={{ padding: 16, borderRadius: 14, gap: 8, backgroundColor: status.background, borderWidth: 1, borderColor: status.border }}><Text style={{ fontSize: 19, fontWeight: '800', color: status.color }}>{status.title}</Text><Text style={{ fontSize: 15, color: status.color }}>{label}</Text></View>
      <Text accessibilityLiveRegion="polite" style={{ fontSize: 15, color: '#334155', lineHeight: 23 }}>{message}</Text>
      {!ready ? <Button title="일정 다시 조회" onPress={() => setReload((value) => value + 1)} /> : null}
      <Text style={{ color: '#475569', fontSize: 14, lineHeight: 22 }}>시작 시·30분 전·1일 전 중 필요한 알림을 선택하세요. 지난 시각은 예약하지 않습니다.</Text>
      {([0, 30, 1440] as const).map((offset) => {
        const reserved = Boolean(schedule && reminderOffsetReserved(schedule.id, evidence, offset, schedule.startsAt));
        const title = offset === 0 ? '시작 시' : offset === 30 ? '30분 전' : '1일 전';
        const disabled = busy || !ready || (!schedule && (!date || !time));
        return <Pressable key={offset} accessibilityRole="button" accessibilityLabel={`${title} 알림 ${reserved ? '예약됨, 다시 확인' : '설정'}`} disabled={disabled} onPress={() => void reserve(offset)} style={[styles.alarmChoice, reserved ? styles.alarmReserved : null, disabled ? styles.disabled : null]}><Text style={styles.alarmTitle}>{title}</Text><Text style={{ color: reserved ? '#047857' : '#1d4ed8', fontWeight: '700' }}>{reserved ? '✓ 예약됨 · 다시 확인' : '알림 설정 ›'}</Text></Pressable>;
      })}
      <Button color="#475569" title="휴대폰 알림 권한 설정" onPress={() => void Linking.openSettings().catch(() => setMessage('휴대폰 설정에서 업무수첩 QA 알림 권한을 확인해주세요.'))} />
      <Button color="#475569" title="정확한 알람 권한 설정" onPress={() => void openExactAlarmPermissionSettings().catch(() => setMessage('휴대폰 설정에서 정확한 알람 권한을 확인해주세요.'))} />
      <Pressable accessibilityRole="button" disabled={busy} onPress={onClose} style={styles.alarmChoice}><Text style={styles.alarmTitle}>닫기</Text></Pressable>
    </ScrollView>
  </Modal>;
}

const styles = StyleSheet.create({
  alarmChoice: { minHeight: 64, padding: 16, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 14, backgroundColor: '#f8fafc', gap: 6 },
  alarmReserved: { backgroundColor: '#ecfdf5', borderColor: '#6ee7b7' },
  alarmTitle: { color: '#0f172a', fontSize: 17, fontWeight: '700' },
  pickerTrigger: { minHeight: 50, justifyContent: 'center', paddingHorizontal: 14, borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: 12, backgroundColor: mobileTheme.colors.surface },
  pickerText: { fontSize: 16, color: mobileTheme.colors.text },
  placeholder: { color: mobileTheme.colors.textMuted },
  disabled: { opacity: 0.5 },
});
