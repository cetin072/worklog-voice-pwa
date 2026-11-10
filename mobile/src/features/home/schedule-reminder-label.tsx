import { Pressable, Text, View } from 'react-native';
import type { BriefingSchedule } from '@/src/platform/worklog-api';
import { reminderPresentation } from './reminder-label';
import { useReminderStatus } from './home-reminder-status';

/** Compact icons retain full verified words for screen readers and the detail sheet. */
export function CompactReminderLabel({ id, record = false, title, onPress, disabled = false }: {
  id?: string; record?: boolean; title: string; onPress(): void; disabled?: boolean;
}) {
  const label = useReminderStatus(id, record);
  const status = reminderPresentation(label);
  const reserved = label.startsWith('이 기기 예약:');
  const unset = label.includes('알림 없음');
  const permission = label.includes('권한');
  const color = reserved ? status.color : unset ? '#64748b' : permission ? '#b91c1c' : '#2563eb';
  // Android emoji cannot be recolored reliably; use a border bell without native dependencies.
  const badge = reserved ? '✓' : unset ? '−' : permission ? '!' : '?';
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}, ${label}, 알림 설정 열기`}
    disabled={disabled} onPress={onPress} style={{ minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center', alignSelf: 'flex-start', maxWidth: '100%', opacity: disabled ? 0.5 : 1 }}>
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: 30, height: 28, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 16, height: 16, borderWidth: 2, borderColor: color, borderTopLeftRadius: 9, borderTopRightRadius: 9, borderBottomLeftRadius: 3, borderBottomRightRadius: 3, backgroundColor: reserved ? color : 'transparent' }} />
      <View style={{ position: 'absolute', top: 3, width: 3, height: 3, borderRadius: 2, backgroundColor: color }} />
      <View style={{ position: 'absolute', bottom: 3, width: 5, height: 3, borderRadius: 2, backgroundColor: color }} />
      <Text style={{ position: 'absolute', right: -2, bottom: 0, fontSize: 11, lineHeight: 14, fontWeight: '900', color, backgroundColor: '#fff', borderRadius: 7, minWidth: 12, textAlign: 'center' }}>{badge}</Text>
    </View>
  </Pressable>;
}
export function ScheduleReminderLabel({ schedule, onPress }: { schedule: BriefingSchedule; onPress(): void }) {
  return <CompactReminderLabel id={schedule.scheduleId} title={schedule.title || '일정'} onPress={onPress} />;
}
