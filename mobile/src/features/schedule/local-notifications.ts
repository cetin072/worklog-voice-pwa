import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { secureSessionStorage } from '@/src/platform/secure-storage';

const NOTIFICATION_MAPPING_KEY = 'worklog.mobile.schedule-notifications.v1';
const CHANNEL_ID = 'worklog-schedule-reminders';

type NotificationMappings = Record<string, { identifier: string; triggerAt: string }>;

Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });

async function mappings(): Promise<NotificationMappings> {
  const raw = await secureSessionStorage.getItem(NOTIFICATION_MAPPING_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw) as NotificationMappings; } catch { return {}; }
}

async function saveMappings(value: NotificationMappings) {
  await secureSessionStorage.setItem(NOTIFICATION_MAPPING_KEY, JSON.stringify(value));
}

export async function requestScheduleNotificationPermission() {
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync(CHANNEL_ID, { name: '일정 알림', importance: Notifications.AndroidImportance.DEFAULT, vibrationPattern: [0, 180] });
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return current;
  return Notifications.requestPermissionsAsync();
}

export async function scheduleReminder({ scheduleId, title, triggerAt }: { scheduleId: string; title: string; triggerAt: Date }) {
  if (triggerAt.getTime() <= Date.now()) throw new Error('과거 시각에는 알림을 예약할 수 없습니다.');
  const permission = await requestScheduleNotificationPermission();
  if (!permission.granted) throw new Error('알림 권한이 필요합니다. 휴대폰 설정에서 업무수첩 알림을 허용해주세요.');
  const saved = await mappings();
  const previous = saved[scheduleId];
  if (previous?.triggerAt === triggerAt.toISOString()) return previous.identifier;
  if (previous) await Notifications.cancelScheduledNotificationAsync(previous.identifier).catch(() => undefined);
  const identifier = await Notifications.scheduleNotificationAsync({ content: { title: '업무수첩 · 일정 알림', body: title, data: { scheduleId, target: 'schedule' } }, trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerAt, channelId: CHANNEL_ID } });
  saved[scheduleId] = { identifier, triggerAt: triggerAt.toISOString() };
  await saveMappings(saved);
  return identifier;
}

export async function cancelScheduleReminder(scheduleId: string) {
  const saved = await mappings();
  const previous = saved[scheduleId];
  if (!previous) return false;
  await Notifications.cancelScheduledNotificationAsync(previous.identifier).catch(() => undefined);
  delete saved[scheduleId];
  await saveMappings(saved);
  return true;
}
