import React, { useEffect, useRef, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { usePlatform } from '../../providers/platform-provider';
import { reminderSessionEpoch } from '../schedule/schedule-reminder-snapshot';
import { useCalendarConnection } from './use-calendar-connection';
import { CalendarEndPicker, calendarDateLabel } from './calendar-end-picker';
import { calendarEndIssue, calendarExportEnd, type CalendarSource } from './calendar-source';
import { readCalendarEntry } from './calendar-record-source';

/** QA-only optional output. Opening or connecting never writes an event. */
export function CalendarExportPreview({ scheduleId: directScheduleId, recordId, title }: {
  scheduleId?: string; recordId?: string; title: string; startsAt?: string; allDay?: boolean; dateKey?: string;
}) {
  const scheduleId = directScheduleId;
  const target = { recordId, scheduleId };
  const platform = usePlatform();
  const [visible, setVisible] = useState(false);
  const [source, setSource] = useState<CalendarSource | null>(null);
  const [end, setEnd] = useState('');
  const [adjustTime, setAdjustTime] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('아직 등록하지 않았습니다.');
  const [, redraw] = useState(0);
  const generation = useRef(0);
  const gate = useRef(false);
  const owner = useRef(platform.session?.user.id);
  owner.current = platform.session?.user.id;
  useEffect(() => () => { generation.current++; }, []);
  const connection = useCalendarConnection();
  if (process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT !== 'qa') return null;
  const close = () => { generation.current++; setVisible(false); setBusy(false); gate.current = false; };
  const context = () => {
    const captured = generation.current;
    const userId = owner.current;
    const sessionCurrent = reminderSessionEpoch.capture();
    return { userId, current: () => captured === generation.current && userId === owner.current && sessionCurrent() };
  };
  async function open() {
    generation.current++; setVisible(true); setSource(null); setEnd(''); setAdjustTime(false); setMessage('서버의 최신 원본을 확인하는 중…');
    const { userId, current } = context();
    if (!platform.client || !userId || (!scheduleId && !recordId)) { setMessage('일정과 로그인 상태를 다시 확인해주세요.'); return; }
    try {
      const latest = await readCalendarEntry(platform.client, target, userId, current);
      if (!current()) return;
      const exportEnd = calendarExportEnd(latest);
      setSource(latest); setEnd(exportEnd); setAdjustTime(!!calendarEndIssue(latest, exportEnd));
      setMessage('아직 등록하지 않았습니다.');
    } catch (error) { if (current()) setMessage((error as Error).message === 'CALENDAR_DATE_REQUIRED' ? '업무의 날짜를 먼저 설정해주세요. 알림 설정은 필요하지 않습니다.' : '최신 업무의 날짜와 시간을 확인하지 못했습니다. 닫고 다시 시도해주세요.'); }
  }
  async function send() {
    if (!connection || !source || !platform.client || gate.current) return;
    const issue = calendarEndIssue(source, end);
    if (issue) { setMessage(issue); return; }
    const { userId, current } = context(); if (!userId) return;
    gate.current = true; setBusy(true); setMessage('최신 원본과 Google 등록 결과를 확인하는 중…');
    try {
      const result = await connection.send(source, end,
        () => readCalendarEntry(platform.client!, target, userId, current), current);
      if (!current()) return;
      if (result.state === 'expired' || result.state === 'denied') connection.disconnect();
      setMessage(result.state === 'confirmed'
        ? result.alreadyExists ? '같은 일정이 이미 등록되어 있습니다. Google 조회로 확인했습니다.' : 'Google 캘린더 등록 완료 · 등록 후 조회로 일치함을 확인했습니다.'
        : result.message);
    } finally { if (current()) { gate.current = false; setBusy(false); redraw(value => value + 1); } }
  }
  const info = connection?.info();
  const endIssue = source ? calendarEndIssue(source, end) : '';
  const disabled = busy || !source || !!endIssue || !info || info.expired;
  if (((!scheduleId && !recordId) || !info || info.expired) && !visible) return null;
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`${title} Google 캘린더에 보내기`} onPress={() => void open()} hitSlop={{ top: 6, bottom: 6, left: 3, right: 3 }} style={styles.shortcut}>
      <Image accessible={false} source={require('../../../assets/google-g.png')} style={styles.googleIcon} /><Text style={styles.shortcutText}>캘린더</Text>
    </Pressable>
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.overlay}><View style={styles.card}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={styles.heading}>Google 캘린더에 추가</Text>
        <Text style={styles.text}>{source?.title || title}</Text>
        {source ? <>
          <Text style={styles.text}>시작: {calendarDateLabel(source.start, source.allDay, source.timeZone)}{source.allDay ? ' · 종일' : ''}</Text>
          {!source.allDay ? <Text style={styles.text}>종료: {calendarDateLabel(end, false, source.timeZone)}</Text> : null}
          {!source.end && end === calendarExportEnd(source) ? <Text style={styles.hint}>{source.allDay ? 'Google에는 종일 일정으로 하루 표시합니다.' : 'Google에는 기본 30분 일정으로 표시합니다.'}</Text> : null}
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => setAdjustTime(value => !value)} style={styles.button}><Text style={styles.link}>{adjustTime ? '시간 변경 닫기' : '시간 변경'}</Text></Pressable>
          {adjustTime ? <CalendarEndPicker key={source.scheduleId} source={source} value={end} disabled={busy} onChange={setEnd} /> : null}
          {adjustTime && !source.allDay ? <View style={styles.durationRow}>{[30, 60].map(minutes => <Pressable key={minutes} accessibilityRole="button" disabled={busy}
            accessibilityLabel={`${minutes}분 일정으로 선택`} style={styles.duration}
            onPress={() => setEnd(new Date(Date.parse(source.start) + minutes * 60000).toISOString())}>
            <Text style={styles.shortcutText}>{minutes === 60 ? '1시간' : '30분'}</Text>
          </Pressable>)}</View> : null}
          {endIssue ? <Text accessibilityLiveRegion="polite" style={styles.validation}>{endIssue}</Text> : null}
          <Text style={styles.hint}>Google에 보낼 시간입니다. 업무수첩 원본은 바뀌지 않습니다.</Text>
        </> : null}
        <Text style={styles.text}>대상: {info?.email || '연결 만료 · 설정에서 다시 연결해주세요'} · 기본 캘린더</Text>
        <Text accessibilityLiveRegion="polite" style={styles.text}>{message}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="확인한 일정 한 건 보내기" accessibilityState={{ disabled: !!disabled }} disabled={!!disabled} onPress={() => void send()}
          style={[styles.primaryButton, disabled ? styles.disabled : null]}><Text style={styles.primaryText}>{busy ? '추가 중…' : '추가'}</Text></Pressable>
        <Text style={styles.hint}>{busy ? '처리 중 닫아도 이미 시작한 등록은 취소되지 않을 수 있습니다.' : '같은 일정을 다시 보내면 기존 등록을 확인해 중복을 방지합니다.'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="캘린더 추가 닫기" onPress={close} style={styles.button}><Text style={styles.link}>닫기</Text></Pressable>
      </ScrollView></View></View>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  button: { minHeight: 48, justifyContent: 'center', paddingVertical: 10 }, link: { color: '#1d4ed8', fontSize: 15 },
  shortcut: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 32, paddingHorizontal: 8, maxWidth: '100%', borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#f8fafc', borderRadius: 12 },
  googleIcon: { width: 14, height: 14 }, shortcutText: { fontSize: 12, flexShrink: 1, fontWeight: '600', color: '#334155' },
  durationRow: { flexDirection: 'row', gap: 10 }, duration: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10 },
  validation: { color: '#b45309', fontSize: 15, lineHeight: 23 }, hint: { color: '#64748b', fontSize: 13, lineHeight: 21 },
  primaryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#1d4ed8' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' }, disabled: { backgroundColor: '#cbd5e1' },
  overlay: { flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 16 },
  card: { backgroundColor: '#fff', borderRadius: 16, maxHeight: '85%' }, content: { padding: 20, gap: 16 },
  input: { borderWidth: 1, borderColor: '#94a3b8', borderRadius: 8, padding: 12, minHeight: 48, fontSize: 16, color: '#0f172a' },
  heading: { fontSize: 20, fontWeight: '700', color: '#0f172a' }, text: { fontSize: 16, lineHeight: 25, color: '#334155' },
});

