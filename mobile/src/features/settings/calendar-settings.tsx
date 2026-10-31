import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useCalendarConnection } from '../calendar/use-calendar-connection';
import { CALENDAR_PERMISSION_NOTICE } from '../calendar/calendar-service';

export function CalendarSettings() {
  const connection = useCalendarConnection();
  if (process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT !== 'qa') return null;
  const info = connection?.info();
  const status = connection?.status();
  return <View style={styles.card}>
    <Text style={styles.title}>Google 캘린더</Text>
    <Text style={styles.text}>{info ? `${info.email} · ${info.expired ? '연결 만료' : '연결됨'}` : '연결 안 됨'}</Text>
    <Text style={styles.text}>원할 때 연결하고 선택한 일정만 보냅니다. 대상은 연결 계정의 기본 캘린더입니다.</Text>
    <Text style={styles.text}>앱 종료·로그아웃·연결 만료 후에는 여기서 다시 연결해주세요.</Text>
    <Pressable accessibilityRole="button" disabled={!connection || status?.connecting} onPress={() => { void connection?.connect().catch(() => undefined); }} style={styles.button}>
      <Text style={styles.link}>{status?.connecting ? '구글 연결 확인 중…' : info ? '다시 연결' : 'Google 캘린더 연결'}</Text>
    </Pressable>
    {info || status?.connecting ? <Pressable accessibilityRole="button" onPress={() => connection?.disconnect()} style={styles.button}><Text style={styles.link}>연결 해제</Text></Pressable> : null}
    <Text accessibilityLiveRegion="polite" style={styles.text}>{status?.message}</Text>
    <Text style={styles.text}>{CALENDAR_PERMISSION_NOTICE}</Text>
    <Text style={styles.text}>업무수첩에 가입된 구글 계정으로 연결해주세요. 다른 계정으로 연결하면 별도 업무수첩 계정이 생성될 수 있습니다.</Text>
  </View>;
}
const styles = StyleSheet.create({
  card: { padding: 16, gap: 12 }, title: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  text: { fontSize: 15, lineHeight: 24, color: '#334155' },
  button: { minHeight: 48, justifyContent: 'center' }, link: { fontSize: 16, color: '#1d4ed8' },
});
