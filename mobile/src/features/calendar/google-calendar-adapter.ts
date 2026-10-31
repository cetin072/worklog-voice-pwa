import type { CalendarDraft, CalendarExportAdapter, CalendarReceipt, CalendarTarget } from './calendar-export';

/** Receives only a verified, ephemeral Calendar grant; never the app login token. */
export function createGoogleCalendarAdapter(target: CalendarTarget, accessToken: string, fetchImpl: typeof fetch): CalendarExportAdapter {
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target.calendarId)}/events`;
  const receipt = (data: any): CalendarReceipt => ({ id: data?.id, status: data?.status, sourceId: data?.extendedProperties?.private?.worklogScheduleId,
    draft: { scheduleId: data?.extendedProperties?.private?.worklogScheduleId, status: data?.status,
      title: data?.summary, allDay: !!data?.start?.date,
      timeZone: data?.start?.timeZone || data?.end?.timeZone || 'Asia/Seoul',
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
