import { cancelAllScheduleReminders, reconcileScheduleReminders, scheduleReminder } from '@/src/features/schedule/local-notifications';
import { reconcileCanceledScheduleArtifacts } from '@/src/features/schedule/schedule-cancellation';
import { confirmedSchedulesFromBriefing, createScheduleReminderCoordinator, export function synchronizeBriefingScheduleReminders(input?: Readonly<{
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
