import { Pressable, Text } from 'react-native';
import type { BriefingSchedule } from '@/src/platform/worklog-api';
import { reminderPresentation } from './reminder-label';
import { useReminderStatus } from './home-reminder-status';

/** Same words, evidence and touch target for schedules and linked records. */
export function CompactReminderLabel({ id, record = false, title, onPress, disabled = false }: {
  id?: string; record?: boolean; title: string; onPress(): void; disabled?: boolean;
}) {
  const label = useReminderStatus(id, record);
  const status = reminderPresentation(label);
  const reserved = label.startsWith('이 기기 예약:');
  const text = reserved ? `${label.slice('이 기기 예약: '.length)} 알림`
    : label.includes('알림 없음') ? '알림 없음' : label.includes('권한') ? '알림 권한 필요'
    : label.includes('일정 취소됨') ? '취소됨 · 알림 확인' : label.includes('완료 일정') ? '완료 · 알림 확인' : '알림 확인 필요';
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}, ${label}, 알림 설정 열기`}
    disabled={disabled} onPress={onPress} hitSlop={{ top: 6, bottom: 6, left: 3, right: 3 }} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', maxWidth: '100%', paddingHorizontal: 4, paddingVertical: 4, opacity: disabled ? 0.5 : 1 }}>
    <Text style={{ color: status.color, fontSize: 12, flexShrink: 1 }}>🔔 {text}</Text>
  </Pressable>;
}
export function ScheduleReminderLabel({ schedule, onPress }: { schedule: BriefingSchedule; onPress(): void }) {
  return <CompactReminderLabel id={schedule.scheduleId} title={schedule.title || '일정'} onPress={onPress} />;
}
