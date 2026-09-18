import * as Calendar from 'expo-calendar';

import { secureSessionStorage } from '@/src/platform/secure-storage';

const CALENDAR_MAPPING_KEY = 'worklog.mobile.calendar-event-mappings.v1';
const PREFERRED_CALENDAR_KEY = 'worklog.mobile.preferred-calendar.v1';

export type DeviceSchedule = {
  scheduleId: string;
  title: string;
  startsAt: string;
  endsAt?: string;
  allDay?: boolean;
  location?: string;
};

export type WritableCalendarOption = {
  id: string;
  title: string;
  ownerAccount: string;
  sourceName: string;
  sourceType: string;
  isGoogle: boolean;
  isPrimary: boolean;
};

type CalendarEventCleanup = { calendarId: string; eventId: string };
type CalendarEventMapping = Record<string, {
  calendarId: string;
  eventId: string;
  fingerprint: string;
  calendarTitle?: string;
  calendarOwnerAccount?: string;
  calendarSourceName?: string;
  calendarIsGoogle?: boolean;
  pendingCleanup?: CalendarEventCleanup[];
}>;
type ExpoCalendar = Awaited<ReturnType<typeof Calendar.getCalendars>>[number];

function fingerprint(schedule: DeviceSchedule) {
  return [schedule.title, schedule.startsAt, schedule.endsAt || '', schedule.allDay ? 'all-day' : '', schedule.location || ''].join('|');
}

function googleCalendar(calendar: ExpoCalendar) {
  const source = `${calendar.source?.name || ''} ${calendar.source?.type || ''} ${calendar.ownerAccount || ''} ${calendar.name || ''}`;
  return /google|gmail/i.test(source);
}

function optionOf(calendar: ExpoCalendar): WritableCalendarOption {
  return {
    id: calendar.id,
    title: calendar.title,
    ownerAccount: String(calendar.ownerAccount || '').trim(),
    sourceName: String(calendar.source?.name || '').trim(),
    sourceType: String(calendar.source?.type || '').trim(),
    isGoogle: googleCalendar(calendar),
    isPrimary: Boolean(calendar.isPrimary),
  };
}

async function readMappings(): Promise<CalendarEventMapping> {
  const raw = await secureSessionStorage.getItem(CALENDAR_MAPPING_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw) as CalendarEventMapping; } catch { return {}; }
}

async function writeMappings(value: CalendarEventMapping) {
  await secureSessionStorage.setItem(CALENDAR_MAPPING_KEY, JSON.stringify(value));
}

function cleanupKey(value: CalendarEventCleanup) {
  return `${value.calendarId}:${value.eventId}`;
}

function appendPendingCleanup(mapping: CalendarEventMapping[string], cleanup: CalendarEventCleanup) {
  const pending = mapping.pendingCleanup || [];
  if (pending.some((value) => cleanupKey(value) === cleanupKey(cleanup))) return pending;
  return [...pending, cleanup];
}

async function deleteCalendarEvent(eventId: string) {
  await (await Calendar.ExpoCalendarEvent.get(eventId)).delete();
}

export async function getPreferredCalendarId() {
  return secureSessionStorage.getItem(PREFERRED_CALENDAR_KEY);
}

export async function setPreferredCalendarId(calendarId: string) {
  if (!calendarId) return secureSessionStorage.removeItem(PREFERRED_CALENDAR_KEY);
  await secureSessionStorage.setItem(PREFERRED_CALENDAR_KEY, calendarId);
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

export async function listWritableCalendarOptions() {
  const calendars = await listWritableCalendars();
  return calendars
    .map(optionOf)
    .sort((left, right) => Number(right.isGoogle) - Number(left.isGoogle) || Number(right.isPrimary) - Number(left.isPrimary) || left.title.localeCompare(right.title, 'ko-KR'));
}

export async function resolvePreferredCalendar() {
  const calendars = await listWritableCalendars();
  const preferredId = await getPreferredCalendarId();
  const preferred = calendars.find((calendar) => calendar.id === preferredId);
  const selected = preferred || calendars.find((calendar) => googleCalendar(calendar) && calendar.isPrimary) || calendars.find(googleCalendar) || calendars.find((calendar) => calendar.isPrimary) || calendars[0];
  if (!selected) return null;
  await setPreferredCalendarId(selected.id);
  return optionOf(selected);
}

export async function getScheduleCalendarMapping(scheduleId: string) {
  const mappings = await readMappings();
  return mappings[scheduleId] || null;
}

/**
 * Returns every schedule for which this device still owns a Calendar event.
 * Startup cancellation recovery uses these durable local references to repair
 * a server-cancelled schedule when the cancellation marker itself was lost.
 */
export async function listTrackedCalendarScheduleIds() {
  return Object.keys(await readMappings());
}

export async function syncScheduleToCalendar(calendarId: string, schedule: DeviceSchedule) {
  const calendars = await listWritableCalendars();
  const calendar = calendars.find((candidate) => candidate.id === calendarId);
  if (!calendar) throw new Error('선택한 캘린더를 찾을 수 없거나 수정할 수 없습니다. 다른 캘린더를 선택해주세요.');
  const calendarOption = optionOf(calendar);
  const calendarMetadata = {
    calendarTitle: calendarOption.title,
    calendarOwnerAccount: calendarOption.ownerAccount,
    calendarSourceName: calendarOption.sourceName,
    calendarIsGoogle: calendarOption.isGoogle,
  };
  await setPreferredCalendarId(calendarId);

  const mappings = await readMappings();
  const current = mappings[schedule.scheduleId];
  const nextFingerprint = fingerprint(schedule);
  const startDate = new Date(schedule.startsAt);
  const endDate = schedule.endsAt ? new Date(schedule.endsAt) : new Date(startDate.getTime() + (schedule.allDay ? 86_400_000 : 3_600_000));

  if (current?.calendarId === calendarId && current.fingerprint === nextFingerprint) return { eventId: current.eventId, created: false };

  if (current?.eventId && current.calendarId === calendarId) {
    let updated = false;
    try {
      await (await Calendar.ExpoCalendarEvent.get(current.eventId)).update({ title: schedule.title, startDate, endDate, allDay: Boolean(schedule.allDay), location: schedule.location || '' });
      updated = true;
    } catch { /* A deleted or detached OS event is recreated below. */ }
    if (current.calendarId === calendarId && updated) {
      mappings[schedule.scheduleId] = { calendarId, eventId: current.eventId, fingerprint: nextFingerprint, ...calendarMetadata, pendingCleanup: current.pendingCleanup };
      await writeMappings(mappings);
      return { eventId: current.eventId, created: false };
    }
  }

  const event = await calendar.createEvent({ title: schedule.title, startDate, endDate, allDay: Boolean(schedule.allDay), location: schedule.location || '', timeZone: 'Asia/Seoul' });
  if (current?.eventId && current.calendarId !== calendarId) {
    try {
      // A cross-calendar change is a move, never an update followed by a duplicate create.
      await deleteCalendarEvent(current.eventId);
    } catch {
      // Keep A authoritative until B can be rolled back.  Silently accepting this
      // failure would leave an untracked duplicate event in Calendar A and B.
      try {
        await deleteCalendarEvent(event.id);
      } catch {
        mappings[schedule.scheduleId] = {
          ...current,
          pendingCleanup: appendPendingCleanup(current, { calendarId, eventId: event.id }),
        };
        await writeMappings(mappings);
      }
      throw new Error('기존 캘린더 일정을 제거하지 못해 이동을 취소했습니다. 잠시 후 다시 시도해주세요.');
    }
  }
  mappings[schedule.scheduleId] = { calendarId, eventId: event.id, fingerprint: nextFingerprint, ...calendarMetadata, pendingCleanup: current?.pendingCleanup };
  await writeMappings(mappings);
  return { eventId: event.id, created: true };
}

export async function removeScheduleFromCalendar(scheduleId: string) {
  const mappings = await readMappings();
  const current = mappings[scheduleId];
  if (!current) return false;
  const eventIds = [...new Set([current.eventId, ...(current.pendingCleanup || []).map((cleanup) => cleanup.eventId)])];
  try {
    for (const eventId of eventIds) await deleteCalendarEvent(eventId);
  } catch {
    // Retain the mapping so a user-initiated removal or cancellation can retry
    // rather than losing an orphan event that the app no longer knows about.
    throw new Error('휴대폰 캘린더 일정을 제거하지 못했습니다. 권한과 동기화 상태를 확인한 뒤 다시 시도해주세요.');
  }
  delete mappings[scheduleId];
  await writeMappings(mappings);
  return true;
}

/**
 * If a cross-calendar move could not roll back the new event, preserve the old
 * mapping and retry only that orphan cleanup at the next app start.
 */
export async function reconcileCalendarEventCleanup() {
  const mappings = await readMappings();
  let cleaned = 0;
  let remaining = 0;
  let changed = false;

  for (const mapping of Object.values(mappings)) {
    if (!mapping.pendingCleanup?.length) continue;
    const unresolved: CalendarEventCleanup[] = [];
    for (const cleanup of mapping.pendingCleanup) {
      try {
        await deleteCalendarEvent(cleanup.eventId);
        cleaned += 1;
      } catch {
        unresolved.push(cleanup);
      }
    }
    remaining += unresolved.length;
    if (unresolved.length) mapping.pendingCleanup = unresolved;
    else delete mapping.pendingCleanup;
    changed = true;
  }

  if (changed) await writeMappings(mappings);
  return { cleaned, remaining };
}
