import { useEffect, useState } from 'react';
import { AppState, Pressable, Text } from 'react-native';
import type { BriefingSchedule } from '@/src/platform/worklog-api';
import { readScheduleReminderEvidence } from '../schedule/local-notifications';
import { reminderLabel } from './reminder-label';
export function ScheduleReminderLabel({ schedule, onPress }: { schedule: BriefingSchedule; onPress(): void }) {
  const [label, setLabel] = useState('알림 확인 필요');
  useEffect(() => {
    let alive = true;
    let epoch = 0;
    async function read() {
      const current = ++epoch;
      setLabel('알림 확인 필요');
      try {
        const evidence = await readScheduleReminderEvidence(schedule.scheduleId!);
        if (alive && current === epoch) setLabel(reminderLabel(schedule.scheduleId!, evidence, Date.now(), schedule.startsAt));
      } catch { if (alive && current === epoch) setLabel('알림 확인 필요'); }
    }
    void read();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void read(); });
    return () => { alive = false; subscription.remove(); };
  }, [schedule.scheduleId, schedule.startsAt]);
  return <Pressable accessibilityRole="button" accessibilityLabel={`${schedule.title || '일정'} ${label}, 알림 설정 열기`} onPress={onPress} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: '#1d4ed8', flexShrink: 1 }}>🔔 {label}</Text></Pressable>;
}
