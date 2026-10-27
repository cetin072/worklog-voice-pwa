import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import type { ConfirmedSchedule } from './schedule-reminder-coordinator';
import { assertReminderSyncCurrent, readOwnedReminderSnapshots, type ReminderSyncGuard } from './schedule-reminder-snapshot';
export type ReminderTarget = { recordId?: string; scheduleId?: string; title: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function findWorklogReminder(client: PlatformSupabaseClient, target: ReminderTarget, guard: ReminderSyncGuard): Promise<ConfirmedSchedule | null> {
  assertReminderSyncCurrent(guard);
  let ids: string[];
  if (target.scheduleId) ids = [target.scheduleId];
  else {
    if (!UUID.test(target.recordId || '')) throw new Error('INVALID_RECORD_ID');
    const owner = await client.auth.getUser();
    if (owner.error || !owner.data.user) throw new Error('REMINDER_OWNER_UNVERIFIED');
    const { data, error, count } = await client.from('schedules').select('id', { count: 'exact' })
      .eq('created_by_user_id', owner.data.user.id)
      .or(`metadata->>workRecordId.eq.${target.recordId},metadata->>reminderWorkRecordId.eq.${target.recordId}`);
    if (error) throw error;
    assertReminderSyncCurrent(guard);
    const after = await client.auth.getUser();
    if (after.error || after.data.user?.id !== owner.data.user.id) throw new Error('REMINDER_OWNER_CHANGED');
    if (!data || count !== data.length || data.length > 1) throw new Error('INCOMPLETE_REMINDER_SNAPSHOT');
    ids = data.map((row) => row.id);
  }
  const snapshot = await readOwnedReminderSnapshots(client, ids, guard);
  if (snapshot.unresolvedIds.length) throw new Error('INCOMPLETE_REMINDER_SNAPSHOT');
  return snapshot.rows[0] || null;
}

export async function confirmWorklogReminder(client: PlatformSupabaseClient, recordId: string, startsAt: string, guard: ReminderSyncGuard) {
  assertReminderSyncCurrent(guard);
  if (!UUID.test(recordId)) throw new Error('INVALID_RECORD_ID');
  const { data, error } = await client.rpc('confirm_my_worklog_reminder', { p_record_id: recordId, p_starts_at: startsAt });
  if (error) throw error;
  assertReminderSyncCurrent(guard);
  if (!Array.isArray(data) || data.length !== 1 || !UUID.test(data[0].schedule_id)) throw new Error('INVALID_REMINDER_RESPONSE');
  const snapshot = await readOwnedReminderSnapshots(client, [data[0].schedule_id], guard);
  if (snapshot.rows.length !== 1) throw new Error('INCOMPLETE_REMINDER_SNAPSHOT');
  return snapshot.rows[0];
}

/** Resolve stable record links in bounded batches. Ambiguous/missing links remain unknown. */
export async function findWorklogReminderLinks(client: PlatformSupabaseClient, recordIds: string[], guard: ReminderSyncGuard) {
  const ids = [...new Set(recordIds)].filter(id => UUID.test(id));
  assertReminderSyncCurrent(guard);
  const before = await client.auth.getUser();
  const owner = before.data.user?.id;
  if (before.error || !owner) throw new Error('REMINDER_OWNER_UNVERIFIED');
  const links: Record<string, string[]> = {};
  for (let start = 0; start < ids.length; start += 50) {
    const batch = ids.slice(start, start + 50);
    const values = batch.join(',');
    const { data, error, count } = await client.from('schedules')
      .select('id,created_by_user_id,metadata', { count: 'exact' }).eq('created_by_user_id', owner)
      .or(`metadata->>workRecordId.in.(${values}),metadata->>reminderWorkRecordId.in.(${values})`);
    assertReminderSyncCurrent(guard);
    if (error) throw error;
    if (!data || count !== data.length) throw new Error('INCOMPLETE_REMINDER_SNAPSHOT');
    for (const row of data) {
      if (row.created_by_user_id !== owner || !UUID.test(row.id)) throw new Error('REMINDER_OWNER_UNVERIFIED');
      for (const recordId of new Set([row.metadata?.workRecordId, row.metadata?.reminderWorkRecordId])) {
        if (typeof recordId === 'string' && batch.includes(recordId)) (links[recordId] ||= []).push(row.id);
      }
    }
  }
  const after = await client.auth.getUser();
  assertReminderSyncCurrent(guard);
  if (after.error || after.data.user?.id !== owner) throw new Error('REMINDER_OWNER_CHANGED');
  return links;
}
