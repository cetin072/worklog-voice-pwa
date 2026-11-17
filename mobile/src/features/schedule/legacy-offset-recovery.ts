import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import { withRequestDeadline } from '@/src/platform/request-deadline';
import { assertReminderSyncCurrent, readOwnedReminderSnapshots, type ReminderSyncGuard } from './schedule-reminder-snapshot';

/** A private migration queue, not UI data or proof of ownership. Its exact
 * project/schema/account scope is supplied by the verified Platform context. */
export function createLegacyOffsetRecovery(deps: {
  candidates(scope: string): Promise<string[]>;
  restore(scope: string, ids: readonly string[], rows: Awaited<ReturnType<typeof readOwnedReminderSnapshots>>['rows'], current: ReminderSyncGuard): Promise<unknown>;
}) {
  return async (client: PlatformSupabaseClient, scope: string, current: ReminderSyncGuard) => {
    assertReminderSyncCurrent(current);
    const ids = await deps.candidates(scope);
    if (!ids.length) return;
    const [, , expectedOwner] = JSON.parse(scope) as [string, string, string];
    const snapshot = await withRequestDeadline(() => readOwnedReminderSnapshots(client, ids, current));
    assertReminderSyncCurrent(current);
    if (!expectedOwner || snapshot.userId !== expectedOwner) throw Error('LEGACY_OFFSET_OWNER_CHANGED');
    // A successful complete query can discard absent/foreign rows. On any read
    // error retain the bound queue for retry; never fall back to old content.
    await deps.restore(scope, ids, snapshot.rows, current);
  };
}
