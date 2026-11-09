import type { PersonalCalendarEvent } from '../calendar/personal-calendar-api';

export function seoulDate(value: string | number = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  return ['year', 'month', 'day'].map(key => parts.find(p => p.type === key)?.value).join('-');
}
export function shiftDay(day: string, amount: number) {
  return new Date(Date.parse(day + 'T12:00:00Z') + amount * 86400000).toISOString().slice(0, 10);
}
export function shiftMonth(day: string, amount: number) {
  return new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1 + amount, 1)).toISOString().slice(0, 10);
}
export function calendarDays(selected: string, expanded: boolean): (string | null)[] {
  const first = expanded ? selected.slice(0, 7) + '-01' : selected;
  const offset = (new Date(first + 'T12:00:00Z').getUTCDay() + 6) % 7;
  if (!expanded) return Array.from({ length: 7 }, (_, i) => shiftDay(first, i - offset));
  const count = new Date(Date.UTC(Number(first.slice(0, 4)), Number(first.slice(5, 7)), 0)).getUTCDate();
  const length = Math.ceil((offset + count) / 7) * 7;
  return Array.from({ length }, (_, i) => i < offset || i >= offset + count ? null : shiftDay(first, i - offset));
}
export function eventsOnDay(events: PersonalCalendarEvent[], day: string) {
  const start = Date.parse(day + 'T00:00:00+09:00'), end = start + 86400000;
  const unique = new Map<string, PersonalCalendarEvent>();
  for (const e of events) {
    const from = Date.parse(e.starts_at), to = Date.parse(e.ends_at || '');
    if (e.source !== 'personal' || ['cancelled', '취소'].includes(e.status) || !Number.isFinite(from)) continue;
    if (from < end && (Number.isFinite(to) && to > from ? to : from + 1) > start) unique.set(e.id, e);
  }
  return [...unique.values()].sort((a, b) => Number(b.all_day) - Number(a.all_day) || Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.id.localeCompare(b.id));
}
export function calendarTime(event: PersonalCalendarEvent, day: string) {
  if (event.all_day) return '종일';
  if (seoulDate(event.starts_at) < day) return '계속';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }).format(new Date(event.starts_at));
}
