import type { PlatformSupabaseClient } from '../../platform/supabase';
import { calendarEventId } from './calendar-export';
import { readCalendarSource, type CalendarSource } from './calendar-source';

/** RLS-owned record dates are independent of native reminder reservations. */
export async function readRecordCalendarSource(client: PlatformSupabaseClient, id: string, owner: string, current: () => boolean): Promise<CalendarSource> {
  calendarEventId(id);
  const before = await client.auth.getUser();
  if (!current() || before.error || before.data.user?.id !== owner) throw Error('SOURCE_OWNER_CHANGED');
  const { data: row, error } = await client.from('work_records')
    .select('id,workspace_id,created_by_user_id,title,due_at,metadata,updated_at,status')
    .eq('id', id).eq('created_by_user_id', owner).single();
  if (error || !row || row.id !== id || row.created_by_user_id !== owner || !row.workspace_id
    || !['in_progress', 'waiting', 'needs_review'].includes(row.status) || !row.title?.trim()
    || !Number.isFinite(Date.parse(row.updated_at))) throw Error('SOURCE_UNAVAILABLE');
  if (!row.due_at) throw Error('CALENDAR_DATE_REQUIRED');
  const details = await client.rpc('get_my_work_record_edit', { p_record_id: id });
  const detail = Array.isArray(details.data) ? details.data[0] : details.data;
  if (details.error || detail?.record_id !== id || detail.title_value !== row.title || Date.parse(detail.due_at_value) !== Date.parse(row.due_at)
    || typeof detail.due_has_time !== 'boolean') throw Error('SOURCE_UNAVAILABLE');
  const linked = await client.from('schedules').select('id', { count: 'exact' })
    .eq('created_by_user_id', owner).or(`metadata->>workRecordId.eq.${id},metadata->>reminderWorkRecordId.eq.${id}`);
  if (linked.error || !linked.data || linked.count !== linked.data.length || linked.data.length > 1) throw Error('SOURCE_UNAVAILABLE');
  const after = await client.auth.getUser();
  if (!current() || after.error || after.data.user?.id !== owner) throw Error('SOURCE_OWNER_CHANGED');
  const timeZone = 'Asia/Seoul';
  const instant = new Date(row.due_at);
  if (!Number.isFinite(instant.getTime())) throw Error('SOURCE_UNAVAILABLE');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const date = ['year', 'month', 'day'].map(key => parts.find(part => part.type === key)?.value).join('-');
  return { scheduleId: id, ownerId: owner, workspaceId: row.workspace_id, revision: row.updated_at,
    title: row.title, status: 'confirmed', timeZone, allDay: !detail.due_has_time,
    start: detail.due_has_time ? row.due_at : date, end: '', legacyScheduleId: linked.data[0]?.id || '' };
}

/** Both list entries use the record identity when they describe the same work. */
export async function readCalendarEntry(client: PlatformSupabaseClient, target: { recordId?: string; scheduleId?: string }, owner: string, current: () => boolean): Promise<CalendarSource> {
  if (target.recordId) return readRecordCalendarSource(client, target.recordId, owner, current);
  if (!target.scheduleId) throw Error('SOURCE_UNAVAILABLE');
  const source = await readCalendarSource(client, target.scheduleId, owner, current);
  return source;
}
