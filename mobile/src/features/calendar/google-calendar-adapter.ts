import { validateCalendarReadRange, type CalendarReadAdapter, type ExternalCalendarEvent } from './calendar-read';
import { calendarEventId } from './calendar-export';
import type { CalendarDraft, CalendarExportAdapter, CalendarReceipt, CalendarTarget } from './calendar-export';

/** Receives only a verified, ephemeral Calendar grant; never the app login token. */
export function createGoogleCalendarAdapter(target: CalendarTarget, accessToken: string, fetchImpl: typeof fetch): CalendarExportAdapter & CalendarReadAdapter {
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target.calendarId)}/events`;
  const receipt = (data: any): CalendarReceipt => ({ id: data?.id, status: data?.status, sourceId: data?.extendedProperties?.private?.worklogScheduleId,
    draft: { scheduleId: data?.extendedProperties?.private?.worklogScheduleId, status: data?.status,
      title: data?.summary, allDay: !!data?.start?.date,
      timeZone: data?.start?.timeZone || data?.end?.timeZone || '',
      start: data?.start?.date || data?.start?.dateTime, end: data?.end?.date || data?.end?.dateTime } });
  async function request(url: string, body?: object) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      let response: Response;
      try { response = await fetchImpl(url, { method: body ? 'POST' : 'GET', signal: controller.signal,
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}) }); } catch { throw Error('CALENDAR_OFFLINE'); }
      if (response.status === 401) throw Error('CALENDAR_EXPIRED');
      if (response.status === 403) throw Error('CALENDAR_DENIED');
      return response;
    } finally { clearTimeout(timer); }
  }
  return {
    target: { ...target },
    async list(range, current) {
      validateCalendarReadRange(range);
      const events = new Map<string, ExternalCalendarEvent>();
      let pageToken = '';
      let malformed = false;
      const seen = new Set<string>();
      for (let page = 0; page < 4; page++) {
        if (!current()) throw Error('CALENDAR_OWNER_CHANGED');
        const url = new URL(base);
        const params = { timeMin: range.start, timeMax: range.end, singleEvents: 'true',
          orderBy: 'startTime', showDeleted: 'false', timeZone: 'Asia/Seoul', maxResults: '250',
          fields: 'items(id,status,summary,start,end,location,description,updated,extendedProperties),nextPageToken' };
        for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const response = await request(url.toString());
        if (!response.ok) throw Error('CALENDAR_READ_FAILED');
        const data = await response.json();
        if (!current()) throw Error('CALENDAR_OWNER_CHANGED');
        if (!data || (data.items !== undefined && !Array.isArray(data.items))) throw Error('CALENDAR_READ_FAILED');
        for (const item of data.items || []) {
          if (item?.status === 'cancelled') continue;
          const event = readEvent(item, target);
          if (!event) { malformed = true; continue; }
          if (Date.parse(event.starts_at) < Date.parse(range.end) && Date.parse(event.ends_at!) > Date.parse(range.start)) events.set(event.id, event);
        }
        pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
        if (!pageToken) return { events: [...events.values()], limited: malformed };
        if (seen.has(pageToken)) break;
        seen.add(pageToken);
      }
      return { events: [...events.values()], limited: true };
    },
    async get(id) {
      const response = await request(`${base}/${encodeURIComponent(id)}`);
      if (response.status === 404) return null;
      if (response.status === 410) return { id, status: 'cancelled', sourceId: '' };
      if (!response.ok) throw Error('CALENDAR_READ_FAILED');
      return receipt(await response.json());
    },
    async insert(id: string, draft: CalendarDraft) {
      const response = await request(base, {
        id, summary: draft.title.trim(),
        start: draft.allDay ? { date: draft.start } : { dateTime: draft.start, timeZone: draft.timeZone },
        end: draft.allDay ? { date: draft.end } : { dateTime: draft.end, timeZone: draft.timeZone },
        extendedProperties: { private: { worklogScheduleId: draft.scheduleId } },
        // No attendees, attachments, automatic notification or other user data.
        reminders: { useDefault: false },
      });
      if (!response.ok) throw Error('CALENDAR_WRITE_UNCONFIRMED');
      return receipt(await response.json());
    },
  };
}

function readEvent(item: any, target: CalendarTarget): ExternalCalendarEvent | null {
  if (!item || typeof item.id !== 'string' || !item.id) return null;
  const allDay = typeof item.start?.date === 'string';
  const date = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
    && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  const timed = (v: unknown) => typeof v === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
  if (allDay ? !date(item.start.date) || !date(item.end?.date) : !timed(item.start?.dateTime) || !timed(item.end?.dateTime)) return null;
  // Date-only events are floating calendar dates; convert to Seoul midnight,
  // preserving Google's exclusive end date instead of parsing them as UTC.
  const start = allDay ? item.start.date + 'T00:00:00+09:00' : item.start.dateTime;
  const end = allDay ? item.end.date + 'T00:00:00+09:00' : item.end.dateTime;
  if (Date.parse(end) <= Date.parse(start)) return null;
  let linkedScheduleId: string | undefined;
  const source = item.extendedProperties?.private?.worklogScheduleId;
  if (typeof source === 'string') {
    try { if (item.id === calendarEventId(source)) linkedScheduleId = source; } catch { /* not an app export */ }
  }
  return { id: ['external', target.accountId, target.calendarId, item.id].map(encodeURIComponent).join(':'),
    source: 'external', editable: false, title: typeof item.summary === 'string' && item.summary.trim() ? item.summary : '제목 없는 일정',
    starts_at: start, ends_at: end, all_day: allDay, location: typeof item.location === 'string' ? item.location : null,
    description: typeof item.description === 'string' ? item.description : '', status: item.status === 'tentative' ? 'tentative' : 'confirmed',
    updated_at: typeof item.updated === 'string' ? item.updated : '', linkedScheduleId };
}
