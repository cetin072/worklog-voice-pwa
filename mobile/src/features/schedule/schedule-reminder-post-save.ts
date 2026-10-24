import { cancelAllScheduleReminders, reconcileScheduleReminders, synchronizeScheduleReminders, scheduleReminder, listTrackedReminderScheduleIds } from '@/src/features/schedule/local-notifications';
import { reconcileCanceledScheduleArtifacts } from '@/src/features/schedule/schedule-cancellation';
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
}>;

/** The only post-save boundary shared by Direct Entry and Quick Voice. */
export function synchronizeSavedScheduleReminders(result: SavedScheduleResult, responseIsCurrent: ReminderSyncGuard) {
  assertReminderSyncCurrent(responseIsCurrent);
  const isCurrent = reminderSyncEpoch.begin();
  const schedules = result.schedules?.length ? result.schedules : [result.schedule];
  return coordinator.synchronizeMany(schedules, isCurrent);
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
