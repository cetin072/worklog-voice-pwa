import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useCalendarConnection } from '../calendar/use-calendar-connection';
import { useExternalCalendar } from '../calendar/use-external-calendar';
import { seoulDate } from '../home/home-calendar-model';
import { CALENDAR_PERMISSION_NOTICE } from '../calendar/calendar-service';

export function CalendarSettings() {
  const connection = useCalendarConnection();
  const [showDetails, setShowDetails] = useState(false);
  const [refreshRequested, setRefreshRequested] = useState(false);
  const google = useExternalCalendar(seoulDate().slice(0, 7), 0, refreshRequested);
  const info = connection?.info();
  const status = connection?.status();
  return <View style={styles.card}>
    <View style={styles.heading}>
      <Text style={styles.title}>Google 캘린더</Text>
      <Text style={styles.connectionStatus}>{status?.connecting ? '연결 확인 중…' : info ? info.expired ? '연결 만료' : '연결됨' : '연결 안 됨'}</Text>
    </View>
    <Text style={styles.hint}>연결하면 기본 Google 캘린더 일정을 홈·내 캘린더에서 볼 수 있습니다. 업무수첩 일정은 Google 아이콘을 눌러 한 건씩 추가합니다.</Text>
    {info?.renewalVerified === false ? <Text accessibilityLiveRegion="polite" style={styles.text}>현재 연결은 사용할 수 있지만 자동 갱신은 아직 확인되지 않았습니다. 서버 준비 전에는 인증 만료 후 다시 연결해야 할 수 있습니다.</Text> : null}
    {info?.email ? <Text selectable style={styles.hint}>{info.email}</Text> : null}
    <View style={styles.actions}>
    <Pressable accessibilityRole="button" accessibilityLabel="Google 캘린더 연결" disabled={!connection || status?.connecting} onPress={() => { void connection?.connect().catch(() => undefined); }} style={styles.button}>
      <Text style={styles.link}>{status?.connecting ? '연결 중…' : info ? '다시 연결' : '연결'}</Text>
    </Pressable>
    {info && !info.expired ? <Pressable accessibilityRole="button" disabled={google.loading || status?.connecting}
      onPress={() => { setRefreshRequested(true); google.refresh(); }} style={styles.button}>
      <Text style={styles.link}>{google.loading ? '불러오는 중…' : 'Google 새로고침'}</Text>
    </Pressable> : null}
    {info || status?.connecting ? <Pressable accessibilityRole="button" onPress={() => { setRefreshRequested(false); connection?.disconnect(); }} style={styles.button}><Text style={styles.link}>연결 해제</Text></Pressable> : null}
    </View>
    {refreshRequested && info && !google.loading ? <Text accessibilityLiveRegion="polite" style={styles.hint}>
      {google.error || (google.limited ? '일부 Google 일정만 불러왔습니다.' : 'Google 일정을 확인했습니다.')}
    </Text> : null}
    {status?.message && status.message !== '연결되었습니다.' ? <Text accessibilityLiveRegion="polite" style={styles.text}>{status.message}</Text> : null}
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: showDetails }} onPress={() => setShowDetails(value => !value)} style={styles.detailsButton}><Text style={styles.hint}>{showDetails ? '연결 안내 접기' : '연결 안내'}</Text></Pressable>
    {showDetails ? <View style={styles.details}>
    <Text style={styles.hint}>가져온 Google 일정은 읽기 전용입니다. 수정·삭제는 Google 캘린더에서 할 수 있습니다. 업무수첩 기록이나 알림으로 자동 저장하지 않습니다.</Text>
    <Text style={styles.hint}>기본 캘린더에 추가합니다. 서버 준비와 연결 유지 권한 확인이 완료되면 인증 시간이 지나도 자동 갱신합니다. 로그아웃·연결 해제 후 또는 Google에서 재동의가 필요한 경우에만 다시 연결해주세요.</Text>
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
