import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import {
  isSubscriptionReminderRequest,
  planSubscriptionReminders,
  SUBSCRIPTION_REMINDER_OWNER,
  type PlannedSubscriptionReminder,
} from './subscription-reminder-plan';
import type { Subscription } from './subscription-model';

const CHANNEL_ID = 'worklog-subscription-reminders';

export type SubscriptionReminderSyncResult =
  | { status: 'unsupported' }
  | { status: 'permission-needed' }
  | { status: 'synced'; scheduled: number };

let queue: Promise<unknown> = Promise.resolve();

async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: '구독·결제 알림',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
  });
}

function requestFor(reminder: PlannedSubscriptionReminder) {
  return {
    identifier: reminder.identifier,
    content: {
      title: reminder.title,
      body: reminder.body,
      sound: 'default' as const,
      data: { owner: SUBSCRIPTION_REMINDER_OWNER, target: 'subscriptions', subscriptionId: reminder.subscriptionId, kind: reminder.kind, date: reminder.date },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(reminder.triggerAt), channelId: CHANNEL_ID },
  };
}

export async function readSubscriptionReminderPermission() {
  if (Platform.OS === 'web') return 'unsupported' as const;
  const current = await Notifications.getPermissionsAsync();
  return current.granted ? 'granted' as const : current.canAskAgain ? 'undetermined' as const : 'denied' as const;
}

export async function requestSubscriptionReminderPermission() {
  if (Platform.OS === 'web') return false;
  await ensureChannel();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/**
 * 구독 알림만 전부 지우고 현재 목록 기준으로 다시 건다. 권한을 새로 묻지 않는다
 * (권한 요청은 사용자가 '알림 켜기'를 누를 때만). 실행은 한 번에 하나씩 순서대로.
 */
export function syncSubscriptionReminders(subs: readonly Subscription[], todayKey: string, nowMs = Date.now()): Promise<SubscriptionReminderSyncResult> {
  const run = async (): Promise<SubscriptionReminderSyncResult> => {
    if (Platform.OS === 'web') return { status: 'unsupported' };
    if (!(await Notifications.getPermissionsAsync()).granted) return { status: 'permission-needed' };
    await ensureChannel();
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(existing.filter(isSubscriptionReminderRequest).map((r) => Notifications.cancelScheduledNotificationAsync(r.identifier)));
    const plan = planSubscriptionReminders(subs, todayKey, nowMs);
    for (const reminder of plan) await Notifications.scheduleNotificationAsync(requestFor(reminder));
    return { status: 'synced', scheduled: plan.length };
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

/** 로그아웃/계정 전환 시 이 기기에 남은 구독 알림을 모두 지운다. */
export function cancelAllSubscriptionReminders() {
  const run = async () => {
    if (Platform.OS === 'web') return;
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(existing.filter(isSubscriptionReminderRequest).map((r) => Notifications.cancelScheduledNotificationAsync(r.identifier)));
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}
