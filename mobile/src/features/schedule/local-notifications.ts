import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Crypto from 'expo-crypto';

import { secureSessionStorage } from '@/src/platform/secure-storage';
import { createScheduleReminderService, REMINDER_OWNER, type ScheduleReminder } from './schedule-reminder-service';
export { reminderTriggerAt, type ReminderOffsetMinutes, type ScheduleReminder } from './schedule-reminder-service';

const CHANNEL_ID = 'worklog-schedule-reminders';
export const REMINDER_PRESETS = [
  { offsetMinutes: 0, label: '시작 시' },
  { offsetMinutes: 5, label: '5분 전' },
  { offsetMinutes: 10, label: '10분 전' },
  { offsetMinutes: 30, label: '30분 전' },
  { offsetMinutes: 60, label: '1시간 전' },
  { offsetMinutes: 1440, label: '1일 전' },
] as const;

/** Installed explicitly by the application owner, never as an import side effect. */
export function configureScheduleNotificationHandler() {
  Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
}

export async function requestScheduleNotificationPermission() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: '일정 알림', importance: Notifications.AndroidImportance.HIGH,
      sound: 'default', vibrationPattern: [0, 180, 120, 180],
    });
  }
  const current = await Notifications.getPermissionsAsync();
  return current.granted ? current : Notifications.requestPermissionsAsync();
}

function notificationRequest(reminder: ScheduleReminder, scheduleId: string) {
  const label = REMINDER_PRESETS.find((p) => p.offsetMinutes === reminder.offsetMinutes)?.label || `${reminder.offsetMinutes}분 전`;
  return {
    identifier: reminder.identifier,
    content: {
      title: `업무수첩 · ${label}`, body: reminder.title, sound: 'default' as const,
      data: { scheduleId, target: 'schedule', offsetMinutes: reminder.offsetMinutes, triggerAt: reminder.triggerAt, owner: REMINDER_OWNER },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(reminder.triggerAt), channelId: CHANNEL_ID },
  };
}

// Both UI mutations and startup recovery share this one service/operation queue.
const service = createScheduleReminderService({
  storage: secureSessionStorage,
  newId: () => Crypto.randomUUID(),
  driver: {
    list: () => Notifications.getAllScheduledNotificationsAsync(),
    schedule: (reminder, scheduleId) => Notifications.scheduleNotificationAsync(notificationRequest(reminder, scheduleId)),
    cancel: (identifier) => Notifications.cancelScheduledNotificationAsync(identifier),
    permission: async (request) => (await (request ? requestScheduleNotificationPermission() : Notifications.getPermissionsAsync())).granted,
  },
});
export const { scheduleReminder, listScheduleReminders, listTrackedReminderScheduleIds, cancelScheduleReminder,
  cancelAllScheduleReminders, synchronizeScheduleReminders, reconcileScheduleReminders } = service;
