import { listTrackedCalendarScheduleIds, removeScheduleFromCalendar } from './device-calendar';
import { cancelAllScheduleReminders, listTrackedReminderScheduleIds } from './local-notifications';
import { secureSessionStorage } from '@/src/platform/secure-storage';
import type { PlatformSupabaseClient } from '@/src/platform/supabase';

const PENDING_SCHEDULE_CLEANUP_KEY = 'worklog.mobile.pending-schedule-cleanup.v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parsePendingScheduleIds(raw: string | null): string[] {
  if (raw === null) return [];
  let values: unknown;
  try { values = JSON.parse(raw); } catch { throw new Error('일정 정리 대기 기록이 손상됐습니다. 기존 기록은 보존했습니다.'); }
  if (!Array.isArray(values) || !values.every((value) => typeof value === 'string' && UUID_PATTERN.test(value))) {
    throw new Error('일정 정리 대기 기록 형식을 확인하지 못했습니다.');
  }
  return [...new Set(values as string[])];
}
async function pendingScheduleIds() {
  return parsePendingScheduleIds(await secureSessionStorage.getItem(PENDING_SCHEDULE_CLEANUP_KEY));
}
async function updatePendingScheduleIds(update: (ids: string[]) => string[]) {
  return secureSessionStorage.updateItem(PENDING_SCHEDULE_CLEANUP_KEY, (raw) => {
    const next = [...new Set(update(parsePendingScheduleIds(raw)))];
    if (!next.every((sid) => UUID_PATTERN.test(sid))) throw new Error('일정 정리 식별자가 올바르지 않습니다.');
    return JSON.stringify(next);
  });
}

function isMissingCancelRpc(error: { code?: string; message?: string } | null | undefined) {
  const message = error?.message || '';
  return error?.code === 'PGRST202'
    || /Could not find the function public\.cancel_my_schedule/i.test(message)
    || /cancel_my_schedule.*schema cache/i.test(message);
}

async function cancelScheduleDirectly(client: PlatformSupabaseClient, scheduleId: string) {
  const { data: userData, error: userError } = await client.auth.getUser();
  const userId = userData.user?.id;
  if (userError || !userId) throw new Error('일정 취소를 위한 로그인 정보를 확인하지 못했습니다.');

  const { data, error } = await client
    .from('schedules')
    .update({ status: 'cancelled' })
    .eq('id', scheduleId)
    .eq('created_by_user_id', userId)
    .in('status', ['confirmed', 'tentative'])
    .select('id, status')
    .maybeSingle();

  if (error) throw new Error(error.message || '일정을 취소하지 못했습니다.');
  if (!data?.id || data.status !== 'cancelled') {
    throw new Error('취소할 일정을 찾지 못했거나 이미 변경된 일정입니다.');
  }
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
  if (error) {
    if (!isMissingCancelRpc(error)) throw new Error(error.message || '일정을 취소하지 못했습니다.');
    await cancelScheduleDirectly(client, scheduleId);
  }

  try {
    await updatePendingScheduleIds((ids) => [...ids, scheduleId]);
    await cleanupDeviceScheduleArtifacts(scheduleId);
    await updatePendingScheduleIds((ids) => ids.filter((value) => value !== scheduleId));
  } catch {
    throw new Error('일정은 취소됐지만 휴대폰 Calendar 또는 알림 정리가 남았습니다. 앱을 다시 열면 자동으로 다시 시도합니다.');
  }
}

/**
 * Reconciles device artifacts from the Data Core's actual schedule state.
 *
 * The cancellation RPC and SecureStore cannot share one transaction.  If the
 * app exits after the RPC commits but before its marker is persisted, existing
 * Calendar/reminder mappings still identify the orphaned device artifacts.
 * Conversely, a stale marker never authorizes cleanup by itself: only a
 * server-confirmed `cancelled` schedule is eligible for deletion.
 */
export async function reconcileCanceledScheduleArtifacts(client: PlatformSupabaseClient) {
  const pending = await pendingScheduleIds();
  const [calendarScheduleIds, reminderScheduleIds] = await Promise.all([
    listTrackedCalendarScheduleIds(),
    listTrackedReminderScheduleIds(),
  ]);
  const candidateIds = [...new Set([...pending, ...calendarScheduleIds, ...reminderScheduleIds])];
  if (!candidateIds.length) return { cleaned: 0, remaining: 0 };

  const { data, error } = await client
    .from('schedules')
    .select('id, status')
    .in('id', candidateIds)
    .eq('status', 'cancelled');
  if (error) throw new Error(error.message || '취소된 일정 상태를 확인하지 못했습니다.');

  const cancelledIds = new Set(
    (data || []).flatMap((schedule) => (
      typeof schedule.id === 'string' && schedule.status === 'cancelled' ? [schedule.id] : []
    )),
  );
  const remaining = pending.filter((scheduleId) => !cancelledIds.has(scheduleId));
  let cleaned = 0;
  const cleanedIds = new Set<string>();
  for (const scheduleId of candidateIds) {
    if (!cancelledIds.has(scheduleId)) continue;
    try {
      await cleanupDeviceScheduleArtifacts(scheduleId);
      cleaned += 1; cleanedIds.add(scheduleId);
    } catch {
      remaining.push(scheduleId);
    }
  }
  await updatePendingScheduleIds((ids) => [...ids.filter((sid) => !cleanedIds.has(sid)), ...remaining]);
  return { cleaned, remaining: (await pendingScheduleIds()).length };
}
