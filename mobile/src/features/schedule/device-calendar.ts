import * as Calendar from 'expo-calendar';

import { secureSessionStorage } from '@/src/platform/secure-storage';

const CALENDAR_MAPPING_KEY = 'worklog.mobile.calendar-event-mappings.v1';

export type DeviceSchedule = {
  scheduleId: string;
  title: string;
  startsAt: string;
  endsAt?: string;
  allDay?: boolean;
  location?: string;
};

type CalendarEventMapping = Record<string, { calendarId: string; eventId: string; fingerprint: string }>;

function fingerprint(schedule: DeviceSchedule) {
  return [schedule.title, schedule.startsAt, schedule.endsAt || '', schedule.allDay ? 'all-day' : '', schedule.location || ''].join('|');
}

async function readMappings(): Promise<CalendarEventMapping> {
  const raw = await secureSessionStorage.getItem(CALENDAR_MAPPING_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw) as CalendarEventMapping; } catch { return {}; }
}

async function writeMappings(value: CalendarEventMapping) {
  await secureSessionStorage.setItem(CALENDAR_MAPPING_KEY, JSON.stringify(value));
}

export async function requestWritableCalendarPermission() {
  const current = await Calendar.getCalendarPermissions();
  if (current.granted) return current;
  return Calendar.requestCalendarPermissions();
}

export async function listWritableCalendars() {
  const permission = await requestWritableCalendarPermission();
  if (!permission.granted) throw new Error('캘린더 권한이 필요합니다. 휴대폰 설정에서 업무수첩의 캘린더 권한을 허용해주세요.');
  return (await Calendar.getCalendars()).filter((calendar) => calendar.allowsModifications && calendar.isVisible !== false);
}

export async function syncScheduleToCalendar(calendarId: string, schedule: DeviceSchedule) {
  const calendars = await listWritableCalendars();
  const calendar = calendars.find((candidate) => candidate.id === calendarId);
  if (!calendar) throw new Error('선택한 캘린더를 찾을 수 없거나 수정할 수 없습니다. 다른 캘린더를 선택해주세요.');

  const mappings = await readMappings();
  const current = mappings[schedule.scheduleId];
  const nextFingerprint = fingerprint(schedule);
  const startDate = new Date(schedule.startsAt);
  const endDate = schedule.endsAt ? new Date(schedule.endsAt) : new Date(startDate.getTime() + (schedule.allDay ? 86_400_000 : 3_600_000));

  if (current?.calendarId === calendarId && current.fingerprint === nextFingerprint) return { eventId: current.eventId, created: false };

  if (current?.eventId) {
    let updated = false;
    try {
      await (await Calendar.ExpoCalendarEvent.get(current.eventId)).update({ title: schedule.title, startDate, endDate, allDay: Boolean(schedule.allDay), location: schedule.location || '' });
      updated = true;
    } catch { /* A deleted or detached OS event is recreated below. */ }
    if (current.calendarId === calendarId && updated) {
      mappings[schedule.scheduleId] = { calendarId, eventId: current.eventId, fingerprint: nextFingerprint };
      await writeMappings(mappings);
      return { eventId: current.eventId, created: false };
    }
  }

  const event = await calendar.createEvent({ title: schedule.title, startDate, endDate, allDay: Boolean(schedule.allDay), location: schedule.location || '', timeZone: 'Asia/Seoul' });
  mappings[schedule.scheduleId] = { calendarId, eventId: event.id, fingerprint: nextFingerprint };
  await writeMappings(mappings);
  return { eventId: event.id, created: true };
}

export async function removeScheduleFromCalendar(scheduleId: string) {
  const mappings = await readMappings();
  const current = mappings[scheduleId];
  if (!current) return false;
  try { await (await Calendar.ExpoCalendarEvent.get(current.eventId)).delete(); } catch { /* Already removed by the user is converged locally. */ }
  delete mappings[scheduleId];
  await writeMappings(mappings);
  return true;
}
