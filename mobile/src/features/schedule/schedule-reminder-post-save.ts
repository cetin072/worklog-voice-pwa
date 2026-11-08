import { cancelAllScheduleReminders, reconcileScheduleReminders, synchronizeScheduleReminders, scheduleReminder, listTrackedReminderScheduleIds } from '@/src/features/schedule/local-notifications';
import { reconcileCanceledScheduleArtifacts } from '@/src/features/schedule/schedule-cancellation';
import { confirmWorklogReminder } from './worklog-reminder-adapter';
import { confirmedSeoulInstant } from './reminder-feedback';
import {
  confirmedSchedulesFromBriefing,
  createScheduleReminderCoordinator,
  type BriefingScheduleProjection,
  type ConfirmedSchedule,
} from '@/src/features/schedule/schedule-reminder-coordinator';
import { assertReminderSyncCurrent, type ReminderSyncGuard, reminderSyncEpoch, readOwnedReminderSnapshots, createReminderSnapshotReconciler } from './schedule-reminder-snapshot';
import type { PlatformSupabaseClient } from '@/src/platform/supabase';

const coordinator = createScheduleReminderCoordinator({
  reminders: { synchronizeScheduleReminders, scheduleReminder, cancelAllScheduleReminders, reconcileScheduleReminders },
});

type SavedScheduleResult = Readonly<{
  schedule?: ConfirmedSchedule | null;
  schedules?: readonly ConfirmedSchedule[];
  scheduleId?: string;
  scheduleIds?: readonly string[];
}>;

/** A receipt must include the full, committed Schedule before touching native alarms. */
function completeScheduleSnapshot(value: ConfirmedSchedule | null | undefined): value is ConfirmedSchedule {
  return Boolean(value?.id && value.title?.trim() && value.startsAt &&
    Number.isFinite(Date.parse(value.startsAt)) && value.status);
}

/**
 * Existing fast save sometimes falls back from v2 to a legacy RPC that only
 * returns the confirmed Schedule ID. Read that *one* owned canonical Schedule
 * before reserving an Android alarm; never trust a guessed time or account.
 * Full snapshots keep the existing zero-extra-request fast path.
 */
export async function synchronizeSavedScheduleReminders(
  result: SavedScheduleResult,
  responseIsCurrent: ReminderSyncGuard,
  client?: PlatformSupabaseClient | null,
) {
  assertReminderSyncCurrent(responseIsCurrent);
  const isCurrent = reminderSyncEpoch.begin();
  const current = () => responseIsCurrent() && isCurrent();
  const payload = result.schedules?.length ? result.schedules : [result.schedule];
  const ready = payload.filter(completeScheduleSnapshot);
  const ids = [...new Set([
    ...(result.scheduleIds || []), ...(result.scheduleId ? [result.scheduleId] : []),
  ])];
  const known = new Set(ready.map(schedule => schedule.id));
  const missing = ids.filter(id => !known.has(id));

  if (missing.length && client) {
    // A missing snapshot must not silently become a cancelled or unlinked
    // reminder. Read-only RLS and explicit owner check live in this helper.
    const verified = await readOwnedReminderSnapshots(client, missing, current);
    assertReminderSyncCurrent(current);
    if (verified.unresolvedIds.length) throw new Error('INCOMPLETE_REMINDER_SNAPSHOT');
    ready.push(...verified.rows);
  } else if (missing.length) {
    // Without an authenticated owner-scoped reader we cannot infer success.
    // The caller displays a distinct "reservation unconfirmed" status.
    return coordinator.synchronizeMany(ready, current);
  }
  return coordinator.synchronizeMany(ready, current);
}

export function synchronizeUpdatedScheduleReminder(schedule: ConfirmedSchedule | null | undefined, responseIsCurrent: ReminderSyncGuard) {
  assertReminderSyncCurrent(responseIsCurrent);
  const isCurrent = reminderSyncEpoch.begin();
  return coordinator.synchronize(schedule, isCurrent);
}

const reconcileSnapshot = createReminderSnapshotReconciler({
  read: readOwnedReminderSnapshots,
  trackedIds: listTrackedReminderScheduleIds,
  synchronize: coordinator.synchronize,
});

/** Briefing supplies discovery IDs only; canonical rows authorize every mutation. */
export function synchronizeBriefingScheduleReminders(client: PlatformSupabaseClient, input?: Readonly<{
  today?: readonly BriefingScheduleProjection[];
  upcoming?: readonly BriefingScheduleProjection[];
}> | null) {
  return reconcileSnapshot(client, confirmedSchedulesFromBriefing(input).map((row) => row.id), reminderSyncEpoch.begin());
}

export function cancelSavedScheduleReminders(scheduleIds: readonly string[], responseIsCurrent: ReminderSyncGuard) {
  assertReminderSyncCurrent(responseIsCurrent);
  const isCurrent = reminderSyncEpoch.begin();
  return coordinator.cancelConfirmed(scheduleIds, isCurrent);
}

export async function recoverSavedScheduleReminders(client: PlatformSupabaseClient) {
  // Canonical application repairs missing reservations through the same durable
  // service, without a broad native sweep of unverified/other-account IDs.
  const isCurrent = reminderSyncEpoch.begin();
  const canonical = await reconcileSnapshot(client, [], isCurrent);
  const cancellations = await reconcileCanceledScheduleArtifacts(client, isCurrent);
  return { ...canonical, cancellations };
}

/** Manual confirmation shares full offset reconciliation with automatic saves. */
export async function reserveConfirmedReminder(schedule: ConfirmedSchedule, offsetMinutes: 0 | 30 | 1440, isCurrent: ReminderSyncGuard) {
  assertReminderSyncCurrent(isCurrent);
  if (schedule.status !== 'confirmed') throw new Error('REMINDER_INACTIVE');
  const instant = Date.parse(schedule.startsAt || '');
  if (schedule.allDay || !Number.isFinite(instant) || instant - offsetMinutes * 60000 <= Date.now()) throw new Error('TIME_INVALID');
  const result = await coordinator.synchronize(schedule, isCurrent);
  if (result.action !== 'scheduled') throw new Error('INVALID_REMINDER_RESPONSE');
  if (offsetMinutes !== 0) await scheduleReminder({ scheduleId: schedule.id, title: schedule.title!, scheduleStartsAt: schedule.startsAt!, offsetMinutes }, isCurrent);
  return result;
}

/** Post-edit: an unlinked work record gains a separate, owner-verified Schedule.
 * The original record kind/text/due fields are never changed by this bridge.
 * Server success is required before any device reservation. */
export async function synchronizeEditedWorklogReminder(
  client: PlatformSupabaseClient,
  input: Readonly<{ recordId: string; schedule?: ConfirmedSchedule | null; dueDate: string; dueTime: string }>,
  responseIsCurrent: ReminderSyncGuard,
): Promise<'linked' | 'created' | 'no-time'> {
  assertReminderSyncCurrent(responseIsCurrent);
  if (input.schedule) {
    await synchronizeUpdatedScheduleReminder(input.schedule, responseIsCurrent);
    return 'linked';
  }
  if (!input.dueDate.trim() || !input.dueTime.trim()) return 'no-time';
  const startsAt = confirmedSeoulInstant(input.dueDate.trim(), input.dueTime.trim());
  const confirmed = await confirmWorklogReminder(client, input.recordId, startsAt, responseIsCurrent);
  assertReminderSyncCurrent(responseIsCurrent);
  await reserveConfirmedReminder(confirmed, 0, responseIsCurrent);
  return 'created';
}
