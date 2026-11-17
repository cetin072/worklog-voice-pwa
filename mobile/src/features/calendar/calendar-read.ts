import type { PersonalCalendarEvent } from './personal-calendar-api';

/** Provider-neutral read projection; never persisted as an app record/reminder. */
export type ExternalCalendarEvent = PersonalCalendarEvent & { source: 'external'; editable: false; linkedScheduleId?: string };
export type CalendarReadRange = { start: string; end: string };
export type CalendarReadResult = { events: ExternalCalendarEvent[]; limited: boolean };
export type CalendarReadAdapter = {
  list(range: CalendarReadRange, current: () => boolean): Promise<CalendarReadResult>;
};
export function calendarReadRange(months: string): CalendarReadRange {
  const values = months.split(',').sort();
  if (!values.length || values.some(m => !/^(20\d{2})-(0[1-9]|1[0-2])$/.test(m))) throw Error('CALENDAR_RANGE_INVALID');
  const last = values[values.length - 1];
  return { start: values[0] + '-01T00:00:00+09:00',
    end: new Date(Date.UTC(Number(last.slice(0, 4)), Number(last.slice(5, 7)), 1)).toISOString().slice(0, 10) + 'T00:00:00+09:00' };
}
export function validateCalendarReadRange(range: CalendarReadRange) {
  const start = Date.parse(range.start), end = Date.parse(range.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 62 * 86400000) throw Error('CALENDAR_RANGE_INVALID');
}
export function calendarReadMessage(error: unknown): string {
  const code = (error as Error)?.message;
  if (code === 'CALENDAR_EXPIRED') return 'Google 연결이 만료됐습니다. 설정에서 다시 연결해주세요.';
  if (code === 'CALENDAR_DENIED') return 'Google 일정 조회 권한을 확인해주세요. 설정에서 다시 연결할 수 있습니다.';
  if (code === 'CALENDAR_OFFLINE') return 'Google 일정을 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 시도해주세요.';
  return 'Google 일정을 불러오지 못했습니다. 다시 시도해주세요.';
}
/** Hide only an unchanged copy exported by this app, never same-title meetings.
 * If Google changed the content/time, keep both so the change stays visible.
 */
export function mergeCalendarEvents(local: PersonalCalendarEvent[], external: ExternalCalendarEvent[]): PersonalCalendarEvent[] {
  const ids = new Map(local.map(event => [event.id, event]));
  const visible = external.filter(event => {
    const original = event.linkedScheduleId ? ids.get(event.linkedScheduleId) : undefined;
    if (!original || ['cancelled', '취소'].includes(original.status)) return true;
    const expectedEnd = original.ends_at ? Date.parse(original.ends_at) : Date.parse(original.starts_at) + (original.all_day ? 86400000 : 30 * 60000);
    return original.title.trim() !== event.title || original.all_day !== event.all_day
      || (original.location || '') !== (event.location || '') || (original.description || '') !== (event.description || '')
      || (original.status === 'tentative') !== (event.status === 'tentative')
      || Date.parse(original.starts_at) !== Date.parse(event.starts_at) || expectedEnd !== Date.parse(event.ends_at || '');
  });
  return [...local, ...visible];
}
