import { cancelAllScheduleReminders, reconcileScheduleReminders, scheduleReminder } from '@/src/features/schedule/local-notifications';
import { reconcileCanceledScheduleArtifacts } from '@/src/features/schedule/schedule-cancellation';
import {
  confirmedSchedulesFromBriefing,
  createScheduleReminderCoordinator,
  type BriefingScheduleProjection,
  type ConfirmedSchedule,
} from '@/src/features/schedule/schedule-reminder-coordinator';
import type { PlatformSupabaseClient } from '@/src/platform/supabase';

const coordinator = createScheduleReminderCoordinator({
  reminders: { scheduleReminder, cancelAllScheduleReminders, reconcileScheduleReminders },
});

type SavedScheduleResult = Readonly<{
  schedule?: ConfirmedSchedule | null;
  schedules?: readonly ConfirmedSchedule[];
}>;

/** The only post-save boundary shared by Direct Entry and Quick Voice. */
export function synchronizeSavedScheduleReminders(result: SavedScheduleResult) {
  const schedules = result.schedules?.length ? result.schedules : [result.schedule];
  return coordinator.synchronizeMany(schedules);
}

export function synchronizeUpdatedScheduleReminder(schedule: ConfirmedSchedule | null | undefined) {
  return coordinator.synchronize(schedule);
}

/** Rebuilds device reservations only from the current server briefing projection. */
export function synchronizeBriefingScheduleReminders(input?: Readonly<{
  today?: readonly BriefingScheduleProjection[];
  upcoming?: readonly BriefingScheduleProjection[];
}> | null) {
  return coordinator.synchronizeMany(confirmedSchedulesFromBriefing(input));
}

export function cancelSavedScheduleReminders(scheduleIds: readonly string[]) {
  return coordinator.cancelConfirmed(scheduleIds);
}

export function recoverSavedScheduleReminders(client: PlatformSupabaseClient) {
  return coordinator.recover({
    reconcileCanceledScheduleArtifacts: () => reconcileCanceledScheduleArtifacts(client),
  });
}
