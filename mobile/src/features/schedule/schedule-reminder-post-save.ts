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
