import { useEffect, useState } from 'react';
import { Alert, Button, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  getPreferredCalendarId,
  getScheduleCalendarMapping,
  listWritableCalendarOptions,
  removeScheduleFromCalendar,
  setPreferredCalendarId,
  synchronizeMappedScheduleToCalendar,
  syncScheduleToCalendar,
  type WritableCalendarOption,
} from './device-calendar';
import {
  cancelAllScheduleReminders,
  cancelScheduleReminder,
  listScheduleReminders,
  REMINDER_PRESETS,
  reminderTriggerAt,
  scheduleReminder,
  synchronizeScheduleReminders,
  type ReminderOffsetMinutes,
  type ScheduleReminder,
} from './local-notifications';
import { cancelScheduleWithDeviceCleanup } from './schedule-cancellation';
import type { BriefingSchedule } from '@/src/platform/worklog-api';
import { usePlatform } from '@/src/providers/platform-provider';

function reminderTime(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function calendarSubtitle(calendar: WritableCalendarOption) {
  const account = calendar.ownerAccount || calendar.sourceName;
  if (calendar.isGoogle) return account ? `Google Calendar · ${account}` : 'Google Calendar';
  return account || calendar.sourceName || '휴대폰 캘린더';
}

export function ScheduleDeviceActions({ schedule }: { schedule: BriefingSchedule }) {
  const { client } = usePlatform();
  const [calendarOptions, setCalendarOptions] = useState<WritableCalendarOption[]>([]);
  const [calendarId, setCalendarId] = useState<string | null>(null);
  const [calendarLoaded, setCalendarLoaded] = useState(false);
  const [calendarSynced, setCalendarSynced] = useState(false);
  const [calendarMapping, setCalendarMapping] = useState<Awaited<ReturnType<typeof getScheduleCalendarMapping>> | null>(null);
  const [reminders, setReminders] = useState<ScheduleReminder[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const scheduleId = schedule.scheduleId || '';
  const startsAt = schedule.startsAt || '';

  useEffect(() => {
    if (!scheduleId) return;
    void (async () => {
      const deviceSchedule = {
        scheduleId,
        title: schedule.title || '업무수첩 일정',
        startsAt,
        allDay: schedule.allDay,
        location: schedule.location,
      };
      await synchronizeScheduleReminders({ scheduleId, title: deviceSchedule.title, scheduleStartsAt: startsAt }).catch(() => undefined);
      await synchronizeMappedScheduleToCalendar(deviceSchedule).catch(() => undefined);
      const [preferred, mapping, savedReminders] = await Promise.all([getPreferredCalendarId(), getScheduleCalendarMapping(scheduleId), listScheduleReminders(scheduleId)]);
      setCalendarId(mapping?.calendarId || preferred);
      setCalendarSynced(Boolean(mapping));
      setCalendarMapping(mapping);
      setReminders(savedReminders);
    })().catch(() => undefined);
  }, [scheduleId, startsAt, schedule.title]);

  if (!scheduleId || !startsAt) return null;

  async function loadCalendars() {
    setBusy(true); setMessage('');
    try {
      const calendars = await listWritableCalendarOptions();
      setCalendarOptions(calendars);
      setCalendarLoaded(true);
      if (!calendars.length) throw new Error('수정 가능한 휴대폰 캘린더가 없습니다. Android 설정에서 Google 계정을 추가하고 Calendar 동기화를 켜주세요.');
      const current = calendars.find((calendar) => calendar.id === calendarId);
      const selected = current || calendars.find((calendar) => calendar.isGoogle && calendar.isPrimary) || calendars.find((calendar) => calendar.isGoogle) || calendars.find((calendar) => calendar.isPrimary) || calendars[0];
      setCalendarId(selected.id);
      await setPreferredCalendarId(selected.id);
      setMessage(selected.isGoogle ? `${selected.title} Google Calendar를 선택했습니다.` : `${selected.title} 캘린더를 선택했습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '캘린더 목록을 불러오지 못했습니다.');
    } finally { setBusy(false); }
  }

  async function chooseCalendar(calendar: WritableCalendarOption) {
    setCalendarId(calendar.id);
    await setPreferredCalendarId(calendar.id);
    setMessage(calendar.isGoogle ? `${calendar.title} Google Calendar를 기본 대상으로 선택했습니다.` : `${calendar.title} 캘린더를 선택했습니다.`);
  }

  async function syncCalendar() {
    if (!calendarId) return;
    setBusy(true); setMessage('');
    try {
      const result = await syncScheduleToCalendar(calendarId, {
        scheduleId,
        title: schedule.title || '업무수첩 일정',
        startsAt,
        allDay: schedule.allDay,
        location: schedule.location,
      });
      setCalendarSynced(true);
      setCalendarMapping(await getScheduleCalendarMapping(scheduleId));
      setMessage(result.created ? '선택한 캘린더에 일정을 추가했습니다.' : '선택한 캘린더 일정이 최신 상태입니다.');
    } catch (error) { setMessage(error instanceof Error ? error.message : '캘린더 동기화에 실패했습니다.'); } finally { setBusy(false); }
  }

  async function removeCalendarEvent() {
    setBusy(true); setMessage('');
    try {
      const removed = await removeScheduleFromCalendar(scheduleId);
      setCalendarSynced(false);
      setCalendarMapping(null);
      setMessage(removed ? '휴대폰/Google Calendar에서 이 일정을 제거했습니다.' : '연결된 캘린더 일정이 없습니다.');
    } catch (error) { setMessage(error instanceof Error ? error.message : '캘린더 일정 제거에 실패했습니다.'); } finally { setBusy(false); }
  }

  async function refreshReminders() {
    setReminders(await listScheduleReminders(scheduleId));
  }

  async function toggleReminder(offsetMinutes: ReminderOffsetMinutes) {
    setBusy(true); setMessage('');
    try {
      const active = reminders.some((reminder) => reminder.offsetMinutes === offsetMinutes);
      if (active) {
        await cancelScheduleReminder(scheduleId, offsetMinutes);
        setMessage(`${REMINDER_PRESETS.find((preset) => preset.offsetMinutes === offsetMinutes)?.label || `${offsetMinutes}분 전`} 알림을 취소했습니다.`);
      } else {
        await scheduleReminder({ scheduleId, title: schedule.title || '업무수첩 일정', scheduleStartsAt: startsAt, offsetMinutes });
        setMessage('일정 알림을 예약했습니다.');
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : '일정 알림을 변경하지 못했습니다.'); } finally { await refreshReminders().catch(() => undefined); setBusy(false); }
  }

  async function clearReminders() {
    setBusy(true); setMessage('');
    try {
      const count = await cancelAllScheduleReminders(scheduleId);
      setReminders([]);
      setMessage(count ? `${count}개의 일정 알림을 모두 취소했습니다.` : '예약된 일정 알림이 없습니다.');
    } catch (error) { setMessage(error instanceof Error ? error.message : '일정 알림을 취소하지 못했습니다.'); } finally { await refreshReminders().catch(() => undefined); setBusy(false); }
  }

  async function cancelSchedule() {
    if (!client) {
      setMessage('일정 취소 세션을 확인하지 못했습니다. 다시 로그인해 주세요.');
      return;
    }
    setBusy(true); setMessage('');
    try {
      await cancelScheduleWithDeviceCleanup(client, scheduleId);
      setCalendarSynced(false);
      setCalendarMapping(null);
      setReminders([]);
      setMessage('일정을 취소하고 연결된 Calendar 이벤트와 알림을 정리했습니다. 브리핑을 다시 정리하면 목록에서 사라집니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '일정을 취소하지 못했습니다.');
    } finally { setBusy(false); }
  }

  function confirmScheduleCancellation() {
    Alert.alert('일정 취소', '업무 기록은 유지하고 이 일정만 취소합니다. 연결된 휴대폰 Calendar 이벤트와 알림도 함께 정리합니다.', [
      { text: '돌아가기', style: 'cancel' },
      { text: '일정 취소', style: 'destructive', onPress: () => { void cancelSchedule(); } },
    ]);
  }

  const selectedCalendar = calendarOptions.find((calendar) => calendar.id === calendarId);
  const mappedCalendarOption = calendarOptions.find((calendar) => calendar.id === calendarMapping?.calendarId);
  const hasGoogleCalendar = calendarOptions.some((calendar) => calendar.isGoogle);
  const selectionMatchesMapping = Boolean(calendarMapping && calendarId && calendarMapping.calendarId === calendarId);
  const connectedCalendarLabel = calendarMapping
    ? (calendarMapping.calendarIsGoogle ?? mappedCalendarOption?.isGoogle)
      ? `✓ Google Calendar · ${calendarMapping.calendarOwnerAccount || mappedCalendarOption?.ownerAccount || calendarMapping.calendarTitle || mappedCalendarOption?.title || '연결됨'}`
      : `✓ ${calendarMapping.calendarTitle || mappedCalendarOption?.title || calendarMapping.calendarSourceName || mappedCalendarOption?.sourceName || '휴대폰 캘린더'}`
    : '미연결';
  const reminderSummary = reminders.length
    ? `🔔 이 일정 알림: ${reminders.map((reminder) => REMINDER_PRESETS.find((preset) => preset.offsetMinutes === reminder.offsetMinutes)?.label || `${reminder.offsetMinutes}분 전`).join(' · ')}`
    : '🔕 이 일정 알림 없음';

  return <View style={styles.root}>
    <View style={styles.compactSummary}>
      <View style={styles.summaryText}>
        <Text style={[styles.connectionStatus, calendarSynced ? styles.connectionOn : styles.connectionOff]}>{connectedCalendarLabel}</Text>
        <Text style={styles.reminderStatus}>{reminderSummary}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={expanded ? '이 일정 설정 접기' : '이 일정 설정 펼치기'} style={styles.expandButton} onPress={() => setExpanded((value) => !value)}>
        <Text style={styles.expandText}>{expanded ? '설정 접기 ▴' : '설정 ▾'}</Text>
      </Pressable>
    </View>

    {expanded ? <View style={styles.expanded}>
      <View style={styles.section}>
        <Text style={styles.heading}>캘린더 연결</Text>
        <Text style={styles.help}>이 일정만 선택한 휴대폰/Google Calendar와 동기화합니다.</Text>
        {!calendarLoaded ? <Button title={busy ? '캘린더 확인 중...' : '캘린더 연결·선택'} disabled={busy} onPress={() => void loadCalendars()} /> : null}
        {calendarLoaded && !hasGoogleCalendar ? <Text style={styles.warning}>Google Calendar가 보이지 않습니다. Android 설정 → 계정에서 Google 계정을 추가하고 Calendar 동기화를 켜주세요.</Text> : null}
        {calendarOptions.map((calendar) => <Pressable key={calendar.id} accessibilityRole="button" style={[styles.choice, calendar.id === calendarId ? styles.choiceActive : null]} disabled={busy} onPress={() => void chooseCalendar(calendar)}>
          <Text style={styles.choiceTitle}>{calendar.isGoogle ? 'G · ' : ''}{calendar.title}{calendar.isPrimary ? ' · 기본' : ''}</Text>
          <Text style={styles.choiceMeta}>{calendarSubtitle(calendar)}</Text>
        </Pressable>)}
        {calendarLoaded && selectedCalendar ? <Button title={busy ? '동기화 중...' : calendarMapping ? selectionMatchesMapping ? '연결된 캘린더와 다시 동기화' : '선택한 캘린더로 이동' : '이 일정 캘린더에 추가'} disabled={busy} onPress={() => void syncCalendar()} /> : null}
        {calendarSynced ? <Button title="캘린더에서 이 일정 제거" disabled={busy} onPress={() => void removeCalendarEvent()} /> : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>이 일정 알림</Text>
        <Text style={styles.help}>아래 선택은 이 일정에만 적용됩니다. 필요한 알림을 여러 개 동시에 선택할 수 있습니다.</Text>
        <View style={styles.presetGrid}>{REMINDER_PRESETS.map((preset) => {
          const active = reminders.some((reminder) => reminder.offsetMinutes === preset.offsetMinutes);
          const triggerAt = reminderTriggerAt(startsAt, preset.offsetMinutes);
          const available = triggerAt.getTime() > Date.now();
          return <Pressable key={preset.offsetMinutes} accessibilityRole="button" disabled={busy || !available} style={[styles.preset, active ? styles.presetActive : null, !available ? styles.presetDisabled : null]} onPress={() => void toggleReminder(preset.offsetMinutes)}>
            <Text style={[styles.presetText, active ? styles.presetTextActive : null]}>{active ? '✓ ' : ''}{preset.label}</Text>
          </Pressable>;
        })}</View>
        {reminders.length ? <View style={styles.reminderSummary}><Text style={styles.summaryTitle}>예약된 알림</Text>{reminders.map((reminder) => <Text key={`${reminder.offsetMinutes}-${reminder.identifier}`} style={styles.summaryLine}>• {REMINDER_PRESETS.find((preset) => preset.offsetMinutes === reminder.offsetMinutes)?.label || `${reminder.offsetMinutes}분 전`} · {reminderTime(reminder.triggerAt)}</Text>)}<Button title="이 일정 알림 모두 취소" disabled={busy} onPress={() => void clearReminders()} /></View> : <Text style={styles.muted}>예약된 알림이 없습니다.</Text>}
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>일정 관리</Text>
        <Text style={styles.help}>업무 기록은 보존하고 일정만 취소합니다. 취소된 일정은 브리핑에 다시 표시되지 않습니다.</Text>
        <Button title="이 일정 취소" color="#b42318" disabled={busy} onPress={confirmScheduleCancellation} />
      </View>
    </View> : null}

    {message ? <Text style={styles.message}>{message}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 10, paddingTop: 8 },
  compactSummary: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderWidth: 1, borderColor: '#e1e5ea', borderRadius: 12, backgroundColor: '#f8fafc' },
  summaryText: { flex: 1, minWidth: 0, gap: 4 },
  connectionStatus: { fontSize: 12, fontWeight: '800', lineHeight: 17 },
  connectionOn: { color: '#245c2a' },
  connectionOff: { color: '#737985' },
  reminderStatus: { fontSize: 12, color: '#4b515c', lineHeight: 17 },
  expandButton: { flexShrink: 0, minHeight: 36, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#d7dae0' },
  expandText: { fontSize: 12, fontWeight: '800', color: '#275daf' },
  expanded: { gap: 14 },
  section: { gap: 8, borderTopWidth: 1, borderTopColor: '#eceef1', paddingTop: 12 },
  heading: { fontSize: 14, fontWeight: '800', color: '#30343b' },
  help: { fontSize: 12, color: '#737985', lineHeight: 18 },
  warning: { fontSize: 12, color: '#9a6700', lineHeight: 18, backgroundColor: '#fff8db', padding: 10, borderRadius: 10 },
  choice: { borderWidth: 1, borderColor: '#d7dae0', borderRadius: 12, padding: 12, gap: 3, backgroundColor: '#fff' },
  choiceActive: { borderColor: '#275daf', backgroundColor: '#edf4ff' },
  choiceTitle: { fontSize: 14, fontWeight: '800', color: '#30343b' },
  choiceMeta: { fontSize: 12, color: '#737985' },
  presetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  preset: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: '#cfd5dd', borderRadius: 12, backgroundColor: '#fff' },
  presetActive: { borderColor: '#275daf', backgroundColor: '#275daf' },
  presetDisabled: { opacity: 0.35 },
  presetText: { fontSize: 13, fontWeight: '700', color: '#30343b' },
  presetTextActive: { color: '#fff' },
  reminderSummary: { gap: 5, backgroundColor: '#f4f7fb', borderRadius: 12, padding: 12 },
  summaryTitle: { fontSize: 13, fontWeight: '800', color: '#30343b' },
  summaryLine: { fontSize: 12, color: '#4b515c', lineHeight: 18 },
  muted: { fontSize: 12, color: '#8a9099' },
  message: { fontSize: 13, color: '#245c2a', lineHeight: 18, backgroundColor: '#eaf4ea', padding: 10, borderRadius: 10 },
});
