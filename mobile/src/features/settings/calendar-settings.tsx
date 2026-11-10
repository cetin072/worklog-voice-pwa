import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useCalendarConnection } from '../calendar/use-calendar-connection';
import { CALENDAR_PERMISSION_NOTICE } from '../calendar/calendar-service';

export function CalendarSettings() {
  const connection = useCalendarConnection();
  const [showDetails, setShowDetails] = useState(false);
  const info = connection?.info();
  const status = connection?.status();
  return <View style={styles.card}>
    <View style={styles.heading}>
      <Text style={styles.title}>Google 캘린더</Text>
      <Text style={styles.connectionStatus}>{info ? info.expired ? '연결 만료' : '연결됨' : '연결 안 됨'}</Text>
    </View>
    <Text style={styles.hint}>연결만으로 자동 등록되지 않습니다. 일정의 Google 아이콘을 눌러 한 건씩 추가합니다.</Text>
    {info?.email ? <Text selectable style={styles.hint}>{info.email}</Text> : null}
    <View style={styles.actions}>
    <Pressable accessibilityRole="button" accessibilityLabel="Google 캘린더 연결" disabled={!connection || status?.connecting} onPress={() => { void connection?.connect().catch(() => undefined); }} style={styles.button}>
      <Text style={styles.link}>{status?.connecting ? '연결 중…' : info ? '다시 연결' : '연결'}</Text>
    </Pressable>
    {info || status?.connecting ? <Pressable accessibilityRole="button" onPress={() => connection?.disconnect()} style={styles.button}><Text style={styles.link}>연결 해제</Text></Pressable> : null}
    </View>
    {status?.message && status.message !== '연결되었습니다.' ? <Text accessibilityLiveRegion="polite" style={styles.text}>{status.message}</Text> : null}
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: showDetails }} onPress={() => setShowDetails(value => !value)} style={styles.detailsButton}><Text style={styles.hint}>{showDetails ? '연결 안내 접기' : '연결 안내'}</Text></Pressable>
    {showDetails ? <View style={styles.details}>
    <Text style={styles.hint}>선택한 일정만 Google 캘린더에 추가합니다.</Text>
    <Text style={styles.hint}>기본 캘린더에 추가합니다. 앱 종료·로그아웃·연결 만료 후에는 다시 연결해주세요.</Text>
    <Text style={styles.hint}>{CALENDAR_PERMISSION_NOTICE}</Text>
    <Text style={styles.hint}>업무수첩에 가입된 Google 계정으로 연결해주세요. 다른 계정은 별도 업무수첩 계정이 생성될 수 있습니다.</Text>
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({
  card: { padding: 14, gap: 8 },
  heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 16, fontWeight: '800', color: '#17191d' },
  connectionStatus: { fontSize: 12, color: '#64748b' },
  text: { fontSize: 15, lineHeight: 24, color: '#334155' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10 }, link: { fontSize: 14, color: '#1d4ed8' },
  hint: { fontSize: 13, lineHeight: 20, color: '#64748b' },
  detailsButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }, details: { gap: 8 },
});
