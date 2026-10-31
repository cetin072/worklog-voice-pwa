import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { usePlatform } from '../../providers/platform-provider';
import { reminderSessionEpoch } from '../schedule/schedule-reminder-snapshot';
import { calendarConnection, CALENDAR_PERMISSION_NOTICE } from './calendar-service';
import { readCalendarSource, type CalendarSource } from './calendar-source';

/** QA-only optional output. Opening or connecting never writes an event. */
export function CalendarExportPreview({ scheduleId, title }: {
  scheduleId?: string; title: string; startsAt?: string; allDay?: boolean; dateKey?: string;
}) {
  const platform = usePlatform();
  const [visible, setVisible] = useState(false);
  const [source, setSource] = useState<CalendarSource | null>(null);
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('아직 등록하지 않았습니다.');
  const [, redraw] = useState(0);
  const generation = useRef(0);
  const gate = useRef(false);
  const owner = useRef(platform.session?.user.id);
  owner.current = platform.session?.user.id;
  useEffect(() => () => { generation.current++; }, []);
  const connection = platform.config && platform.session
    ? calendarConnection(platform.config, platform.session.user.id) : null;
  if (process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT !== 'qa') return null;
  const close = () => { generation.current++; setVisible(false); setBusy(false); gate.current = false; };
  const context = () => {
    const captured = generation.current;
    const userId = owner.current;
    const sessionCurrent = reminderSessionEpoch.capture();
    return { userId, current: () => captured === generation.current && userId === owner.current && sessionCurrent() };
  };
  async function open() {
    generation.current++; setVisible(true); setSource(null); setEnd(''); setMessage('서버의 최신 원본을 확인하는 중…');
    const { userId, current } = context();
    if (!platform.client || !userId || !scheduleId) { setMessage('일정과 로그인 상태를 다시 확인해주세요.'); return; }
    try {
      const latest = await readCalendarSource(platform.client, scheduleId, userId, current);
      if (!current()) return;
      setSource(latest); setEnd(latest.end); setMessage('아직 등록하지 않았습니다. 계정과 일정 한 건을 확인해주세요.');
    } catch { if (current()) setMessage('온라인에서 확정된 원본 일정을 조회하지 못했습니다. 닫고 다시 시도해주세요.'); }
  }
  async function connect() {
    if (!connection || gate.current) return;
    const { current } = context(); gate.current = true; setBusy(true);
    try {
      const connected = await connection.connect();
      if (current()) { redraw(value => value + 1); setMessage(connected ? '계정 연결됨 · 아직 등록하지 않았습니다. 아래 한 건 보내기를 눌러주세요.' : '연결을 취소했습니다. 아직 등록하지 않았습니다.'); }
      else connection.disconnect();
    } catch (error) {
      if (current()) setMessage((error as Error).message === 'CALENDAR_AUTH_DENIED' ? '캘린더 권한 동의를 거부했습니다. 아직 등록하지 않았습니다.' : '계정 연결을 확인하지 못했습니다. 온라인 상태와 관리자 callback 설정을 확인해주세요.');
    } finally { if (current()) { gate.current = false; setBusy(false); } }
  }
  async function send() {
    if (!connection || !source || !platform.client || gate.current) return;
    const { userId, current } = context(); if (!userId) return;
    gate.current = true; setBusy(true); setMessage('최신 원본과 Google 등록 결과를 확인하는 중…');
    try {
      const result = await connection.send(source, end,
        () => readCalendarSource(platform.client!, source.scheduleId, userId, current), current);
      if (!current()) return;
      if (result.state === 'expired' || result.state === 'denied') connection.disconnect();
      setMessage(result.state === 'confirmed'
        ? result.alreadyExists ? '같은 일정이 이미 등록되어 있습니다. Google 조회로 확인했습니다.' : 'Google 캘린더 등록 완료 · 등록 후 조회로 일치함을 확인했습니다.'
        : result.message);
    } finally { if (current()) { gate.current = false; setBusy(false); redraw(value => value + 1); } }
  }
  const info = connection?.info();
  return <>
    <Pressable accessibilityRole="button" onPress={() => void open()} style={styles.button}><Text style={styles.link}>Google 캘린더 · 연결 준비</Text></Pressable>
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.overlay}><View style={styles.card}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={styles.heading}>Google 캘린더에 추가</Text>
        <Text style={styles.text}>{source?.title || title}</Text>
        {source ? <>
          <Text style={styles.text}>시작: {source.start}{source.allDay ? ' · 종일' : ''}{'\n'}시간대: {source.timeZone}</Text>
          <Text style={styles.text}>{source.allDay ? '종료일 (이 날짜는 포함하지 않음, YYYY-MM-DD)' : '종료 시각 (날짜·초·UTC 시차 포함, 예: 2026-11-02T11:00:00+09:00)'}</Text>
          <TextInput accessibilityLabel="Google 일정 종료" value={end} editable={!busy && !source.end} onChangeText={setEnd} autoCapitalize="none" style={styles.input} />
          {!source.end ? <Text style={styles.text}>원본에 종료가 없습니다. 추정하지 않으므로 직접 확인해 입력해주세요. 업무수첩 원본은 바뀌지 않습니다.</Text> : null}
        </> : null}
        <Text style={styles.text}>{CALENDAR_PERMISSION_NOTICE}</Text>
        <Text style={styles.text}>다른 Google 계정을 선택하면 인증 과정에서 그 계정의 별도 업무수첩 계정이 만들어질 수 있습니다. 현재 로그인한 업무수첩 계정과 업무공간은 유지됩니다.</Text>
        <Text style={styles.text}>업무수첩 로그인과 별도 연결입니다. 토큰은 이번 앱 실행 중 메모리에만 보관하며 앱 종료·로그아웃·연결 해제·만료 후 다시 연결합니다.</Text>
        <Text style={styles.text}>대상 계정: {info?.email || '연결 안 됨'}{'\n'}대상: 기본 소유 캘린더 (primary){info?.expired ? ' · 연결 만료' : ''}</Text>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void connect()} style={styles.button}><Text style={styles.link}>{info ? '다른 Google 계정 연결' : 'Google 캘린더 계정 연결 (선택)'}</Text></Pressable>
        {info ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => { connection?.disconnect(); redraw(value => value + 1); setMessage('이 앱의 메모리 연결을 해제했습니다. Google 권한 철회는 Google 계정에서 관리하세요.'); }} style={styles.button}><Text style={styles.link}>연결 해제</Text></Pressable> : null}
        <Text accessibilityLiveRegion="polite" style={styles.text}>{message}</Text>
        <Pressable accessibilityRole="button" disabled={busy || !source || !end.trim() || !info || info.expired} onPress={() => void send()} style={styles.button}><Text style={styles.link}>확인한 일정 한 건 보내기</Text></Pressable>
        <Text style={styles.text}>중복·응답 유실 시 같은 ID로 다시 확인합니다. 처리 중 닫아도 이미 전송된 Google 요청은 취소되지 않을 수 있습니다. 닫은 뒤에는 성공으로 표시하지 않습니다.</Text>
        <Pressable accessibilityRole="button" onPress={close} style={styles.button}><Text style={styles.link}>닫기</Text></Pressable>
      </ScrollView></View></View>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  button: { minHeight: 48, justifyContent: 'center', paddingVertical: 10 }, link: { color: '#1d4ed8', fontSize: 15 },
  overlay: { flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 16 },
  card: { backgroundColor: '#fff', borderRadius: 16, maxHeight: '85%' }, content: { padding: 20, gap: 16 },
  input: { borderWidth: 1, borderColor: '#94a3b8', borderRadius: 8, padding: 12, minHeight: 48, fontSize: 16, color: '#0f172a' },
  heading: { fontSize: 20, fontWeight: '700', color: '#0f172a' }, text: { fontSize: 16, lineHeight: 25, color: '#334155' },
});
