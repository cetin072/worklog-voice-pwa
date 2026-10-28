import type { CalendarDraft, CalendarExportAdapter, CalendarReceipt, CalendarTarget } from './calendar-export';

/** Deliberately NOT wired to login. Approval + an account-verified Calendar grant
 * must be supplied by a future authorization boundary. No grant/token is created,
 * registered, persisted, refreshed or inferred from the app's login here.
 */
export function createGoogleCalendarAdapter(target: CalendarTarget, accessToken: string, fetchImpl: typeof fetch): CalendarExportAdapter {
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target.calendarId)}/events`;
  const receipt = (data: any): CalendarReceipt => ({ id: data?.id, status: data?.status, sourceId: data?.extendedProperties?.private?.worklogScheduleId });
  async function request(url: string, body?: object) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      return await fetchImpl(url, { method: body ? 'POST' : 'GET', signal: controller.signal,
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}) });
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
