import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useMeetingRecordingSession } from './meeting-recording-provider';
import { mobileTheme } from '@/src/ui/theme';

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

export function MeetingRecordingBanner({ onOpen }: { onOpen: () => void }) {
  const meeting = useMeetingRecordingSession();
  if (!meeting.active) return null;

  return <Pressable
    accessibilityRole="button"
    accessibilityLabel="진행 중인 회의 녹음으로 돌아가기"
    style={[styles.root, meeting.phase === 'paused' ? styles.rootPaused : null]}
    onPress={onOpen}
  >
    <View style={styles.indicator}>
      <Text style={styles.indicatorText}>{meeting.phase === 'paused' ? 'Ⅱ' : '●'}</Text>
    </View>
    <View style={styles.copy}>
      <Text style={styles.title}>{meeting.phase === 'paused' ? '회의 녹음 일시정지' : meeting.phase === 'stopping' ? '회의 녹음 저장 중' : '회의 녹음 중'}</Text>
      <Text style={styles.meta}>{formatDuration(meeting.durationMs)} · 화면을 이동해도 녹음 세션이 유지됩니다.</Text>
    </View>
    <Text style={styles.action}>열기 ›</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  root: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 13,
    borderRadius: mobileTheme.radius.control,
    borderWidth: 1,
    borderColor: '#e0b4b4',
    backgroundColor: '#fff2f2',
  },
  rootPaused: {
    borderColor: '#e4cf9d',
    backgroundColor: '#fff9e8',
  },
  indicator: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: mobileTheme.colors.surface,
  },
  indicatorText: {
    fontSize: 15,
    fontWeight: '900',
    color: mobileTheme.colors.danger,
  },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  title: { fontSize: 14, fontWeight: '900', color: mobileTheme.colors.text },
  meta: { fontSize: 11, lineHeight: 16, color: mobileTheme.colors.textSecondary },
  action: { fontSize: 12, fontWeight: '800', color: mobileTheme.colors.link },
});
