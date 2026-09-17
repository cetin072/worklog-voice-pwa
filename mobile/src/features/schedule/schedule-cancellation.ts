import { removeScheduleFromCalendar } from './device-calendar';
import { cancelAllScheduleReminders } from './local-notifications';
import { secureSessionStorage } from '@/src/platform/secure-storage';
import type { PlatformSupabaseClient } from '@/src/platform/supabase';

const PENDING_SCHEDULE_CLEANUP_KEY = 'worklog.mobile.pending-schedule-cleanup.v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function pendingScheduleIds() {
  const raw = await secureSessionStorage.getItem(PENDING_SCHEDULE_CLEANUP_KEY);
  if (!raw) return [];
  try {
    const values = JSON.parse(raw) as unknown;
    return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string' && UUID_PATTERN.test(value)) : [];
  } catch {
    return [];
  }
}

async function savePendingScheduleIds(scheduleIds: readonly string[]) {
  const unique = [...new Set(scheduleIds.filter((scheduleId) => UUID_PATTERN.test(scheduleId)))];
  if (!unique.length) return secureSessionStorage.removeItem(PENDING_SCHEDULE_CLEANUP_KEY);
  return secureSessionStorage.setItem(PENDING_SCHEDULE_CLEANUP_KEY, JSON.stringify(unique));
}

async function cleanupDeviceScheduleArtifacts(scheduleId: string) {
  const results = await Promise.allSettled([
    removeScheduleFromCalendar(scheduleId),
    cancelAllScheduleReminders(scheduleId),
  ]);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}

/**
 * Cancels a Data Core schedule first, then converges device state. A durable
 * pending list is recorded only after server confirmation, so restart recovery
 * never removes device artifacts for a schedule whose cancellation is unknown.
 */
export async function cancelScheduleWithDeviceCleanup(client: PlatformSupabaseClient, scheduleId: string) {
  if (!UUID_PATTERN.test(scheduleId)) throw new Error('취소할 일정 정보를 확인하지 못했습니다.');

  const { error } = await client.rpc('cancel_my_schedule', { p_schedule_id: scheduleId });
  if (error) throw new Error(error.message || '일정을 취소하지 못했습니다.');

  const pending = await pendingScheduleIds();
  await savePendingScheduleIds([...pending, scheduleId]);

  try {
    await cleanupDeviceScheduleArtifacts(scheduleId);
    await savePendingScheduleIds((await pendingScheduleIds()).filter((value) => value !== scheduleId));
  } catch {
    throw new Error('일정은 취소됐지만 휴대폰 Calendar 또는 알림 정리가 남았습니다. 앱을 다시 열면 자동으로 다시 시도합니다.');
  }
}

export async function reconcileCanceledScheduleArtifacts() {
  const pending = await pendingScheduleIds();
  const remaining: string[] = [];
  let cleaned = 0;
  for (const scheduleId of pending) {
    try {
      await cleanupDeviceScheduleArtifacts(scheduleId);
      cleaned += 1;
    } catch {
      remaining.push(scheduleId);
    }
  }
  await savePendingScheduleIds(remaining);
  return { cleaned, remaining: remaining.length };
}
