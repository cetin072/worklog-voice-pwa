import { cancelAllScheduleReminders, reconcileScheduleReminders, scheduleReminder } from '@/src/features/schedule/local-notifications';
import { reconcileCanceledScheduleArtifacts } from '@/src/features/schedule/schedule-cancellation';
import { createScheduleReminderCoordinator, type ConfirmedSchedule } from '@/src/features/schedule/schedule-reminder-coordinator';
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

type BriefingScheduleProjection = Readonly<{
  scheduleId?: string;
  title?: string;
  startsAt?: string;
  status?: string;
  allDay?: boolean;
}>;

export function synchronizeBriefingScheduleReminders(input?: Readonly<{
  today?: readonly BriefingScheduleProjection[];
  upcoming?: readonly BriefingScheduleProjection[];
}> | null) {
  const rows = [...(input?.today || []), ...(input?.upcoming || [])];
  const schedules = rows.map((row): ConfirmedSchedule | null => {
    const id = row.scheduleId?.trim() || '';
    const title = row.title?.trim() || '';
    const startsAt = row.startsAt?.trim() || '';
    if (!id || !title || !startsAt) return null;
    const status = row.status === '확정' || row.status === 'confirmed' ? 'confirmed' : (row.status || '');
    return { id, title, startsAt, status, allDay: row.allDay === true };
  }).filter((value): value is ConfirmedSchedule => value !== null);
  return coordinator.synchronizeMany(schedules);
}

export function cancelSavedScheduleReminders(scheduleIds: readonly string[]) {
  return coordinator.cancelConfirmed(scheduleIds);
}

export function recoverSavedScheduleReminders(client: PlatformSupabaseClient) {
  return coordinator.recover({
    reconcileCanceledScheduleArtifacts: () => reconcileCanceledScheduleArtifacts(client),
  });
}
