/**
 * The only mobile bridge from a server-confirmed Schedule to device reminders.
 * Inputs never call Expo Notifications directly; they hand the canonical
 * Schedule snapshot returned by the server to this coordinator.
 */
export type ConfirmedSchedule = Readonly<{
  id: string;
  title?: string;
  startsAt?: string;
  status: string;
  allDay?: boolean;
}>;

export type BriefingScheduleProjection = Readonly<{
  scheduleId?: string;
  title?: string;
  startsAt?: string;
  status?: string;
  allDay?: boolean;
}>;

export function confirmedSchedulesFromBriefing(input?: Readonly<{
  today?: readonly BriefingScheduleProjection[];
  upcoming?: readonly BriefingScheduleProjection[];
}> | null, now = Date.now()) {
  const rows = [...(input?.today || []), ...(input?.upcoming || [])];
  const seen = new Set<string>();
  const schedules: ConfirmedSchedule[] = [];
  for (const row of rows) {
    const id = row.scheduleId?.trim() || '';
    const title = row.title?.trim() || '';
    const startsAt = row.startsAt?.trim() || '';
    const startsAtMs = new Date(startsAt).getTime();
    if (!id || !title || !startsAt || seen.has(id) || !Number.isFinite(startsAtMs) || startsAtMs <= now) continue;
    seen.add(id);
    schedules.push({
      id,
      title,
      startsAt,
      status: row.status === '확정' || row.status === 'confirmed' ? 'confirmed' : (row.status || ''),
      allDay: row.allDay === true,
    });
  }
  return Object.freeze(schedules);
}

type ReminderPort = {
  scheduleReminder(input: { scheduleId: string; title: string; scheduleStartsAt: string; offsetMinutes: 0 }): Promise<unknown>;
  cancelAllScheduleReminders(scheduleId: string): Promise<unknown>;
  reconcileScheduleReminders(): Promise<unknown>;
};

type RecoveryPort = { reconcileCanceledScheduleArtifacts(): Promise<unknown> };

const ACTIVE_STATUS = 'confirmed';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function identifier(value: unknown) {
  const id = typeof value === 'string' ? value.trim() : '';
  return UUID_PATTERN.test(id) ? id : '';
}

function exactFutureInstant(value: unknown) {
  const startsAt = typeof value === 'string' ? value.trim() : '';
  if (!startsAt.includes('T')) return '';
  return Number.isFinite(new Date(startsAt).getTime()) ? startsAt : '';
}

/** Factory keeps the policy executable without importing Expo in runtime tests. */
export function createScheduleReminderCoordinator(deps: { reminders: ReminderPort }) {
  async function synchronize(schedule: ConfirmedSchedule | null | undefined) {
    const scheduleId = identifier(schedule?.id);
    if (!scheduleId) return { action: 'ignored' as const };

    const startsAt = exactFutureInstant(schedule?.startsAt);
    const title = typeof schedule?.title === 'string' ? schedule.title.trim() : '';
    if (schedule?.status !== ACTIVE_STATUS || schedule?.allDay === true || !startsAt || !title) {
      await deps.reminders.cancelAllScheduleReminders(scheduleId);
      return { action: 'cancelled' as const, scheduleId };
    }

    await deps.reminders.scheduleReminder({ scheduleId, title, scheduleStartsAt: startsAt, offsetMinutes: 0 });
    return { action: 'scheduled' as const, scheduleId };
  }

  async function cancelConfirmed(scheduleIds: readonly string[]) {
    for (const value of scheduleIds) {
      const scheduleId = identifier(value);
      if (scheduleId) await deps.reminders.cancelAllScheduleReminders(scheduleId);
    }
  }

  async function synchronizeMany(schedules: readonly (ConfirmedSchedule | null | undefined)[]) {
    const results = [];
    for (const schedule of schedules) results.push(await synchronize(schedule));
    return results;
  }

  async function recover(recovery?: RecoveryPort) {
    let reminderError: unknown;
    let reminders: unknown;
    try { reminders = await deps.reminders.reconcileScheduleReminders(); }
    catch (nextError) { reminderError = nextError; }
    const cancellations = recovery ? await recovery.reconcileCanceledScheduleArtifacts() : undefined;
    if (reminderError) throw reminderError;
    return { reminders, cancellations };
  }

  return Object.freeze({ synchronize, synchronizeMany, cancelConfirmed, recover });
}
