import { useEffect, useRef, useState } from 'react';
import { Button, Linking, Modal, ScrollView, Text, TextInput, View } from 'react-native';
import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import type { ConfirmedSchedule } from './schedule-reminder-coordinator';
import { findWorklogReminder, confirmWorklogReminder, type ReminderTarget } from './worklog-reminder-adapter';
import { confirmedSeoulInstant, reminderFailureMessage } from './reminder-feedback';
import { reserveConfirmedReminder } from './schedule-reminder-post-save';
import { reminderSessionEpoch, reminderSyncEpoch } from './schedule-reminder-snapshot';
import { listScheduleReminders, openExactAlarmPermissionSettings } from './local-notifications';

/** Explicit confirmation never edits a record's kind, deadline or original text. */
export function WorklogReminderSheet({ client, target, onClose }: { client: PlatformSupabaseClient; target: ReminderTarget; onClose(): void }) {
  const [schedule, setSchedule] = useState<ConfirmedSchedule | null>(null);
  const [reload, setReload] = useState(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
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
        <Text>한국 시간(Asia/Seoul) · 날짜와 시간을 직접 확인해주세요.</Text>
        <TextInput accessibilityLabel="알림 날짜" placeholder="YYYY-MM-DD" value={date} onChangeText={setDate} editable={!busy} style={{ borderWidth: 1, padding: 12 }} />
        <TextInput accessibilityLabel="알림 시간" placeholder="HH:mm (24시간)" value={time} onChangeText={setTime} editable={!busy} style={{ borderWidth: 1, padding: 12 }} />
      </View> : null}
      <Text accessibilityLiveRegion="polite">{message}</Text>
      {!ready ? <Button title="일정 다시 조회" onPress={() => setReload((value) => value + 1)} /> : null}
      <Text>확정 일정은 시작 시 자동 알림을 사용합니다. 30분 전·1일 전은 추가 예약입니다. 지난 시각은 예약하지 않습니다.</Text>
      {([0, 30, 1440] as const).map((offset) => <Button key={offset} disabled={busy || !ready} title={`${offset === 0 ? '시작 시' : offset === 30 ? '30분 전' : '1일 전'} 알림 확인 / 예약`} onPress={() => void reserve(offset)} />)}
      <Button title="휴대폰 알림 권한 설정" onPress={() => void Linking.openSettings().catch(() => setMessage('휴대폰 설정에서 업무수첩 QA 알림 권한을 확인해주세요.'))} />
      <Button title="정확한 알람 권한 설정" onPress={() => void openExactAlarmPermissionSettings().catch(() => setMessage('휴대폰 설정에서 정확한 알람 권한을 확인해주세요.'))} />
      <Button title="닫기 / 확인 취소" disabled={busy} onPress={onClose} />
    </ScrollView>
  </Modal>;
}
