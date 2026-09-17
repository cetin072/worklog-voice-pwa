import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { secureSessionStorage } from '@/src/platform/secure-storage';

const LEGACY_NOTIFICATION_MAPPING_KEY = 'worklog.mobile.schedule-notifications.v1';
const NOTIFICATION_MAPPING_KEY = 'worklog.mobile.schedule-notifications.v2';
const PENDING_NOTIFICATION_CLEANUP_KEY = 'worklog.mobile.pending-notification-cleanup.v1';
const CHANNEL_ID = 'worklog-schedule-reminders';

export const REMINDER_PRESETS = [
  { offsetMinutes: 0, label: '시작 시' },
  { offsetMinutes: 5, label: '5분 전' },
  { offsetMinutes: 10, label: '10분 전' },
  { offsetMinutes: 30, label: '30분 전' },
  { offsetMinutes: 60, label: '1시간 전' },
  { offsetMinutes: 1440, label: '1일 전' },
] as const;

export type ReminderOffsetMinutes = (typeof REMINDER_PRESETS)[number]['offsetMinutes'];
export type ScheduleReminder = { identifier: string; triggerAt: string; title: string; offsetMinutes: number };
type NotificationMappings = Record<string, Record<string, ScheduleReminder>>;
type LegacyNotificationMappings = Record<string, { identifier: string; triggerAt: string; title: string }>;
type PendingNotificationCleanup = Record<string, string[]>;

Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });

function reminderLabel(offsetMinutes: number) {
  return REMINDER_PRESETS.find((preset) => preset.offsetMinutes === offsetMinutes)?.label || `${offsetMinutes}분 전`;
}

async function mappings(): Promise<NotificationMappings> {
  const raw = await secureSessionStorage.getItem(NOTIFICATION_MAPPING_KEY);
  if (raw) {
    try { return JSON.parse(raw) as NotificationMappings; } catch { /* fall through to legacy migration */ }
  }

  const legacyRaw = await secureSessionStorage.getItem(LEGACY_NOTIFICATION_MAPPING_KEY);
  if (!legacyRaw) return {};
  try {
    const legacy = JSON.parse(legacyRaw) as LegacyNotificationMappings;
    const migrated: NotificationMappings = {};
    for (const [scheduleId, reminder] of Object.entries(legacy)) {
      migrated[scheduleId] = { '0': { ...reminder, offsetMinutes: 0 } };
    }
    await saveMappings(migrated);
    await secureSessionStorage.removeItem(LEGACY_NOTIFICATION_MAPPING_KEY);
    return migrated;
  } catch {
    return {};
  }
}

async function saveMappings(value: NotificationMappings) {
  await secureSessionStorage.setItem(NOTIFICATION_MAPPING_KEY, JSON.stringify(value));
}

async function pendingNotificationCleanup(): Promise<PendingNotificationCleanup> {
  const raw = await secureSessionStorage.getItem(PENDING_NOTIFICATION_CLEANUP_KEY);
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).map(([scheduleId, identifiers]) => [
      scheduleId,
      Array.isArray(identifiers) ? identifiers.filter((identifier): identifier is string => typeof identifier === 'string' && Boolean(identifier)) : [],
    ]).filter(([, identifiers]) => identifiers.length));
  } catch {
    return {};
  }
}

async function savePendingNotificationCleanup(value: PendingNotificationCleanup) {
  const entries = Object.entries(value).filter(([, identifiers]) => identifiers.length);
  if (!entries.length) return secureSessionStorage.removeItem(PENDING_NOTIFICATION_CLEANUP_KEY);
  return secureSessionStorage.setItem(PENDING_NOTIFICATION_CLEANUP_KEY, JSON.stringify(Object.fromEntries(entries)));
}

async function queueNotificationCleanup(scheduleId: string, identifier: string) {
  const pending = await pendingNotificationCleanup();
  pending[scheduleId] = [...new Set([...(pending[scheduleId] || []), identifier])];
  await savePendingNotificationCleanup(pending);
}

function notificationRequest(reminder: ScheduleReminder, scheduleId: string) {
  return {
    content: {
      title: `업무수첩 · ${reminderLabel(reminder.offsetMinutes)}`,
      body: reminder.title,
      sound: 'default' as const,
      data: { scheduleId, target: 'schedule', offsetMinutes: reminder.offsetMinutes },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(reminder.triggerAt),
      channelId: CHANNEL_ID,
    },
  };
}

export async function requestScheduleNotificationPermission() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: '일정 알림',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 180, 120, 180],
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return current;
  return Notifications.requestPermissionsAsync();
}

export function reminderTriggerAt(scheduleStartsAt: string | Date, offsetMinutes: number) {
  const startsAt = scheduleStartsAt instanceof Date ? scheduleStartsAt : new Date(scheduleStartsAt);
  return new Date(startsAt.getTime() - offsetMinutes * 60_000);
}

export async function listScheduleReminders(scheduleId: string) {
  const saved = await mappings();
  return Object.values(saved[scheduleId] || {}).sort((left, right) => left.offsetMinutes - right.offsetMinutes);
}

export async function scheduleReminder({ scheduleId, title, scheduleStartsAt, offsetMinutes }: { scheduleId: string; title: string; scheduleStartsAt: string | Date; offsetMinutes: ReminderOffsetMinutes }) {
  const triggerAt = reminderTriggerAt(scheduleStartsAt, offsetMinutes);
  if (!Number.isFinite(triggerAt.getTime()) || triggerAt.getTime() <= Date.now()) throw new Error(`${reminderLabel(offsetMinutes)} 알림 시각이 이미 지났습니다.`);
  const permission = await requestScheduleNotificationPermission();
  if (!permission.granted) throw new Error('알림 권한이 필요합니다. 휴대폰 설정에서 업무수첩 알림을 허용해주세요.');

  const saved = await mappings();
  const scheduleReminders = saved[scheduleId] || {};
  const key = String(offsetMinutes);
  const previous = scheduleReminders[key];
  const triggerIso = triggerAt.toISOString();
  if (previous?.triggerAt === triggerIso && previous.title === title) return previous;

  const draft: ScheduleReminder = { identifier: '', triggerAt: triggerIso, title, offsetMinutes };
  const identifier = await Notifications.scheduleNotificationAsync(notificationRequest(draft, scheduleId));
  const reminder = { ...draft, identifier };
  if (previous) {
    try {
      await Notifications.cancelScheduledNotificationAsync(previous.identifier);
    } catch {
      // Keep the prior mapping authoritative until the replacement can be rolled back.
      try {
        await Notifications.cancelScheduledNotificationAsync(identifier);
      } catch {
        await queueNotificationCleanup(scheduleId, identifier);
      }
      throw new Error('기존 일정 알림을 취소하지 못해 변경을 되돌렸습니다. 잠시 후 다시 시도해주세요.');
    }
  }
  scheduleReminders[key] = reminder;
  saved[scheduleId] = scheduleReminders;
  await saveMappings(saved);
  return reminder;
}

export async function cancelScheduleReminder(scheduleId: string, offsetMinutes: number) {
  const saved = await mappings();
  const scheduleReminders = saved[scheduleId];
  const key = String(offsetMinutes);
  const previous = scheduleReminders?.[key];
  if (!previous) return false;
  let queuedForCleanup = false;
  try {
    await Notifications.cancelScheduledNotificationAsync(previous.identifier);
  } catch {
    await queueNotificationCleanup(scheduleId, previous.identifier);
    queuedForCleanup = true;
  }
  delete scheduleReminders[key];
  if (Object.keys(scheduleReminders).length) saved[scheduleId] = scheduleReminders;
  else delete saved[scheduleId];
  await saveMappings(saved);
  if (queuedForCleanup) throw new Error('일정 알림 취소를 다시 시도합니다. 앱을 다시 열면 자동으로 정리됩니다.');
  return true;
}

export async function cancelAllScheduleReminders(scheduleId: string) {
  const saved = await mappings();
  const scheduleReminders = Object.values(saved[scheduleId] || {});
  const unresolved: ScheduleReminder[] = [];
  let queuedForCleanup = 0;
  for (const reminder of scheduleReminders) {
    try {
      await Notifications.cancelScheduledNotificationAsync(reminder.identifier);
    } catch {
      try {
        await queueNotificationCleanup(scheduleId, reminder.identifier);
        queuedForCleanup += 1;
      } catch {
        unresolved.push(reminder);
      }
    }
  }
  if (unresolved.length) saved[scheduleId] = Object.fromEntries(unresolved.map((reminder) => [String(reminder.offsetMinutes), reminder]));
  else delete saved[scheduleId];
  await saveMappings(saved);
  if (unresolved.length) throw new Error('일부 일정 알림을 취소하지 못했습니다. 알림 권한과 기기 상태를 확인한 뒤 다시 시도해주세요.');
  if (queuedForCleanup) throw new Error('일부 일정 알림 취소를 다시 시도합니다. 앱을 다시 열면 자동으로 정리됩니다.');
  return scheduleReminders.length;
}

/** Keeps existing presets aligned when the underlying schedule title or time changes. */
export async function synchronizeScheduleReminders({ scheduleId, title, scheduleStartsAt }: { scheduleId: string; title: string; scheduleStartsAt: string | Date }) {
  const saved = await mappings();
  const reminders = Object.values(saved[scheduleId] || {});
  let updated = 0;
  let removed = 0;
  let failed = 0;

  for (const reminder of reminders) {
    const triggerAt = reminderTriggerAt(scheduleStartsAt, reminder.offsetMinutes);
    if (!Number.isFinite(triggerAt.getTime()) || triggerAt.getTime() <= Date.now()) {
      try {
        await cancelScheduleReminder(scheduleId, reminder.offsetMinutes);
        removed += 1;
      } catch {
        failed += 1;
      }
      continue;
    }
    if (reminder.triggerAt === triggerAt.toISOString() && reminder.title === title) continue;
    try {
      await scheduleReminder({ scheduleId, title, scheduleStartsAt, offsetMinutes: reminder.offsetMinutes as ReminderOffsetMinutes });
      updated += 1;
    } catch {
      failed += 1;
    }
  }
  return { updated, removed, failed };
}

export async function reconcileScheduleReminders() {
  const saved = await mappings();
  const pending = await pendingNotificationCleanup();
  const unresolvedPending: PendingNotificationCleanup = {};
  let cleanedPending = 0;
  for (const [scheduleId, identifiers] of Object.entries(pending)) {
    for (const identifier of identifiers) {
      try {
        await Notifications.cancelScheduledNotificationAsync(identifier);
        cleanedPending += 1;
      } catch {
        unresolvedPending[scheduleId] = [...(unresolvedPending[scheduleId] || []), identifier];
      }
    }
  }
  await savePendingNotificationCleanup(unresolvedPending);
  const system = await Notifications.getAllScheduledNotificationsAsync();
  const activeIds = new Set(system.map((notification) => notification.identifier));
  const now = Date.now();
  let restored = 0;
  let removed = 0;

  for (const [scheduleId, scheduleReminders] of Object.entries(saved)) {
    for (const [key, reminder] of Object.entries(scheduleReminders)) {
      const triggerAt = new Date(reminder.triggerAt);
      if (triggerAt.getTime() <= now) {
        delete scheduleReminders[key];
        removed += 1;
        continue;
      }
      if (!activeIds.has(reminder.identifier)) {
        const identifier = await Notifications.scheduleNotificationAsync(notificationRequest(reminder, scheduleId));
        scheduleReminders[key] = { ...reminder, identifier };
        restored += 1;
      }
    }
    if (!Object.keys(scheduleReminders).length) delete saved[scheduleId];
  }

  await saveMappings(saved);
  return { restored, removed, cleanedPending, pending: Object.values(unresolvedPending).flat().length };
}
