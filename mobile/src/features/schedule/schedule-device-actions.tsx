import { useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';

import { listWritableCalendars, syncScheduleToCalendar } from './device-calendar';
import { scheduleReminder } from './local-notifications';
import type { BriefingSchedule } from '@/src/platform/worklog-api';

export function ScheduleDeviceActions({ schedule }: { schedule: BriefingSchedule }) {
  const [calendarId, setCalendarId] = useState<string | null>(null);
  const [calendarName, setCalendarName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  if (!schedule.scheduleId || !schedule.startsAt) return null;

  async function selectCalendar() {
    setBusy(true); setMessage('');
    try {
      const calendars = await listWritableCalendars();
      const selected = calendars.find((calendar) => calendar.isPrimary) || calendars[0];
      if (!selected) throw new Error('수정 가능한 휴대폰 캘린더가 없습니다. Google Calendar 등 쓰기 가능한 계정을 먼저 추가해주세요.');
      setCalendarId(selected.id); setCalendarName(selected.title);
      setMessage(`${selected.title} 캘린더를 선택했습니다.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '캘린더를 선택하지 못했습니다.'); } finally { setBusy(false); }
  }

  async function syncCalendar() {
    if (!calendarId) return;
    setBusy(true); setMessage('');
    try {
      const result = await syncScheduleToCalendar(calendarId, { scheduleId: schedule.scheduleId!, title: schedule.title || '업무수첩 일정', startsAt: schedule.startsAt!, allDay: schedule.allDay, location: schedule.location });
      setMessage(result.created ? '휴대폰 캘린더에 일정을 추가했습니다.' : '휴대폰 캘린더 일정이 최신 상태입니다.');
    } catch (error) { setMessage(error instanceof Error ? error.message : '캘린더 동기화에 실패했습니다.'); } finally { setBusy(false); }
  }

  async function scheduleAtStart() {
    setBusy(true); setMessage('');
    try {
      await scheduleReminder({ scheduleId: schedule.scheduleId!, title: schedule.title || '업무수첩 일정', triggerAt: new Date(schedule.startsAt!) });
      setMessage('일정 시작 시각에 휴대폰 알림을 예약했습니다.');
    } catch (error) { setMessage(error instanceof Error ? error.message : '일정 알림을 예약하지 못했습니다.'); } finally { setBusy(false); }
  }

  return <View style={styles.root}>
    <Text style={styles.heading}>휴대폰 연결</Text>
    {!calendarId ? <Button title={busy ? '캘린더 확인 중...' : '휴대폰 캘린더 선택'} disabled={busy} onPress={() => void selectCalendar()} /> : <><Text style={styles.selected}>{calendarName}</Text><Button title={busy ? '동기화 중...' : '이 일정 캘린더에 추가'} disabled={busy} onPress={() => void syncCalendar()} /></>}
    <Button title={busy ? '알림 예약 중...' : '일정 시작 시각에 알림'} disabled={busy || new Date(schedule.startsAt).getTime() <= Date.now()} onPress={() => void scheduleAtStart()} />
    {message ? <Text style={styles.message}>{message}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 8, paddingTop: 6 },
  heading: { fontSize: 13, fontWeight: '800', color: '#4b515c' },
  selected: { fontSize: 13, color: '#275daf' },
  message: { fontSize: 13, color: '#4b515c', lineHeight: 18 },
});
