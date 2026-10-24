import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import type { ConfirmedSchedule } from './schedule-reminder-coordinator';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type ReminderSyncGuard = () => boolean;
export function assertReminderSyncCurrent(isCurrent: ReminderSyncGuard) {
  if (!isCurrent()) throw new Error('STALE_REMINDER_SYNC');
}

// Invalidated by a new refresh, session transition, or confirmed local mutation.
export function createReminderSyncEpoch() {
  let epoch = 0;
  return {
    invalidate() { epoch += 1; },
    capture() { const current = epoch; return () => current === epoch; },
    begin() { const current = ++epoch; return () => current === epoch; },
  };
}
export const reminderSyncEpoch = createReminderSyncEpoch();
// A server mutation may overlap other mutations; only session changes invalidate its response.
export const reminderSessionEpoch = createReminderSyncEpoch();

type OwnedSchedule = ConfirmedSchedule & { updatedAt: string };

/** Exact ID scope; no date/status filter, and absence NEVER means cancellation.
 * All batches must be complete and valid before any native mutation is allowed.
 * Existing RLS remains authoritative; creator filtering also excludes shared rows.
 */
export async function readOwnedReminderSnapshots(
  client: PlatformSupabaseClient, scheduleIds: readonly string[], isCurrent: ReminderSyncGuard,
) {
  const ids = [...new Set(scheduleIds)];
  if (!ids.every((id) => UUID.test(id))) throw new Error('INVALID_REMINDER_SCOPE');
  assertReminderSyncCurrent(isCurrent);
  const before = await client.auth.getUser();
  const userId = before.data.user?.id;
  if (before.error || !userId) throw new Error('REMINDER_OWNER_UNVERIFIED');
  const rows: OwnedSchedule[] = [];
  for (let index = 0; index < ids.length; index += 100) {
    assertReminderSyncCurrent(isCurrent);
    const scope = ids.slice(index, index + 100);
    const { data, error, count }: { data: unknown; error: unknown; count: number | null } = await client.from('schedules')
      .select('id, created_by_user_id, title, starts_at, status, all_day, updated_at', { count: 'exact' })
      .in('id', scope).eq('created_by_user_id', userId);
    if (error) throw new Error('REMINDER_SNAPSHOT_UNAVAILABLE');
    if (!Array.isArray(data) || !Number.isInteger(count) || count !== data.length) throw new Error('INCOMPLETE_REMINDER_SNAPSHOT');
    const seen = new Set<string>();
    for (const row of data) {
      if (!scope.includes(row.id) || seen.has(row.id) || row.created_by_user_id !== userId
        || !['confirmed', 'tentative', 'completed', 'cancelled'].includes(row.status)
        || typeof row.title !== 'string' || !row.title.trim() || typeof row.all_day !== 'boolean'
        || typeof row.starts_at !== 'string' || !Number.isFinite(Date.parse(row.starts_at))
        || typeof row.updated_at !== 'string' || !Number.isFinite(Date.parse(row.updated_at))) {
        throw new Error('INVALID_REMINDER_SNAPSHOT');
      }
      seen.add(row.id);
      rows.push({ id: row.id, title: row.title, startsAt: row.starts_at, status: row.status, allDay: row.all_day, updatedAt: row.updated_at });
    }
  }
  const after = await client.auth.getUser();
  assertReminderSyncCurrent(isCurrent);
  if (after.error || after.data.user?.id !== userId) throw new Error('REMINDER_OWNER_CHANGED');
  const returned = new Set(rows.map((row) => row.id));
  return { userId, rows, unresolvedIds: ids.filter((id) => !returned.has(id)) };
}

/** Reject response reordering and server revision rollback within this runtime. */
export function createReminderSnapshotReconciler(deps: {
  read: typeof readOwnedReminderSnapshots;
  trackedIds(): Promise<string[]>;
  synchronize(schedule: ConfirmedSchedule, isCurrent: ReminderSyncGuard): Promise<unknown>;
  now?(): number;
}) {
  const revisions = new Map<string, number>();
  return async (client: PlatformSupabaseClient, visibleIds: readonly string[], isCurrent: ReminderSyncGuard) => {
    const snapshot = await deps.read(client, [...await deps.trackedIds(), ...visibleIds], isCurrent);
    assertReminderSyncCurrent(isCurrent);
    for (const row of snapshot.rows) {
      if (Date.parse(row.updatedAt) < (revisions.get(`${snapshot.userId}:${row.id}`) ?? -Infinity)) throw new Error('STALE_REMINDER_REVISION');
    }
    const errors: unknown[] = [];
    for (const row of snapshot.rows) {
      assertReminderSyncCurrent(isCurrent);
      revisions.set(`${snapshot.userId}:${row.id}`, Date.parse(row.updatedAt));
      // Explicit canonical past/all-day/non-active state, never missing-list inference.
      const schedule = Date.parse(row.startsAt!) <= (deps.now || Date.now)() ? { ...row, status: 'completed' } : row;
      try { await deps.synchronize(schedule, isCurrent); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'REMINDER_SNAPSHOT_APPLY_PENDING');
    return { verified: snapshot.rows.length, unresolved: snapshot.unresolvedIds.length };
  };
}
