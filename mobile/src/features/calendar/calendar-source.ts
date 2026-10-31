import type { PlatformSupabaseClient } from '../../platform/supabase';
import { calendarEventId, validateCalendarDraft, type CalendarDraft } from './calendar-export';

export type CalendarSource = CalendarDraft & { ownerId: string; workspaceId: string; revision: string };

function localDate(instant: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant));
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)?.value).join('-');
}

/** Direct RLS read, never a briefing projection. No Core mutation or service key. */
export async function readCalendarSource(client: PlatformSupabaseClient, id: string, ownerId: string, current: () => boolean): Promise<CalendarSource> {
  calendarEventId(id);
  const before = await client.auth.getUser();
  if (!current() || before.error || before.data.user?.id !== ownerId) throw Error('SOURCE_OWNER_CHANGED');
  const { data: row, error } = await client.from('schedules')
    .select('id,workspace_id,created_by_user_id,title,status,starts_at,ends_at,all_day,timezone,updated_at')
    .eq('id', id).eq('created_by_user_id', ownerId).single();
  const after = await client.auth.getUser();
  if (!current() || after.error || after.data.user?.id !== ownerId) throw Error('SOURCE_OWNER_CHANGED');
  if (error || !row || row.id !== id || row.created_by_user_id !== ownerId || !row.workspace_id
    || row.status !== 'confirmed' || !row.updated_at || !Number.isFinite(Date.parse(row.updated_at))
    || typeof row.title !== 'string' || !row.title.trim() || typeof row.all_day !== 'boolean'
    || !Number.isFinite(Date.parse(row.starts_at))) throw Error('SOURCE_UNAVAILABLE');
  const timeZone = row.timezone;
  new Intl.DateTimeFormat('en', { timeZone }).format();
  if (!timeZone) throw Error('SOURCE_UNAVAILABLE');
  return {
    scheduleId: id, ownerId, workspaceId: row.workspace_id, revision: row.updated_at,
    title: row.title, status: row.status, timeZone, allDay: row.all_day,
    start: row.all_day ? localDate(row.starts_at, timeZone) : row.starts_at,
    end: row.ends_at ? (row.all_day ? localDate(row.ends_at, timeZone) : row.ends_at) : '',
  };
}

export function confirmedCalendarDraft(source: CalendarSource, explicitEnd: string): CalendarDraft {
  const draft: CalendarDraft = { scheduleId: source.scheduleId, title: source.title, status: source.status,
    timeZone: source.timeZone, allDay: source.allDay, start: source.start, end: source.end || explicitEnd.trim() };
  validateCalendarDraft(draft);
  return draft;
}

export function sameCalendarSource(a: CalendarSource, b: CalendarSource) {
  return (Object.keys(a) as (keyof CalendarSource)[]).every(key => a[key] === b[key]);
}
