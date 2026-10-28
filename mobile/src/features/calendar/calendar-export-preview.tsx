import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CALENDAR_APPROVAL_MESSAGE } from './calendar-export';

/** Approval-gated preview only. No login escalation or implied Google success. */
export function CalendarExportPreview({ title, startsAt, allDay, dateKey }: { title: string; startsAt?: string; allDay?: boolean; dateKey?: string }) {
  const [visible, setVisible] = useState(false);
  // Keep this unfinished integration out of Play while QA work continues.
  if (process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT !== 'qa') return null;
  const date = startsAt && Number.isFinite(Date.parse(startsAt))
    ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', ...(allDay ? {} : { timeStyle: 'short' }) }).format(new Date(startsAt)) : dateKey || '시간 확인 필요';
  return <>
    <Pressable accessibilityRole="button" onPress={() => setVisible(true)} style={styles.button}><Text style={styles.link}>Google 캘린더 · 연결 준비</Text></Pressable>
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
      <View style={styles.overlay}><View style={styles.card}><ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={styles.heading}>Google 캘린더에 추가</Text>
        <Text style={styles.text}>{title}</Text><Text style={styles.text}>{date}{allDay ? ' · 종일' : ''} · Asia/Seoul</Text>
        <Text style={styles.text}>{CALENDAR_APPROVAL_MESSAGE}</Text>
        <Text style={styles.text}>연결 후 대상 Google 계정과 종료 시각을 확인해야 합니다. 이 미리보기는 Google 캘린더에 저장되지 않습니다.</Text>
        <Pressable accessibilityRole="button" onPress={() => setVisible(false)} style={styles.button}><Text style={styles.link}>닫기</Text></Pressable>
      </ScrollView></View></View>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  button: { minHeight: 48, justifyContent: 'center', paddingVertical: 10 }, link: { color: '#1d4ed8', fontSize: 15 },
  overlay: { flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 16 },
  card: { backgroundColor: '#fff', borderRadius: 16, maxHeight: '85%' }, content: { padding: 20, gap: 16 },
  heading: { fontSize: 20, fontWeight: '700', color: '#0f172a' }, text: { fontSize: 16, lineHeight: 25, color: '#334155' },
});
