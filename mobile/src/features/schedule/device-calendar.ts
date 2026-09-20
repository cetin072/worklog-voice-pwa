import * as Calendar from 'expo-calendar';
import * as Crypto from 'expo-crypto';

import { secureSessionStorage } from '@/src/platform/secure-storage';

const CALENDAR_MAPPING_KEY = 'worklog.mobile.calendar-event-mappings.v1';
const PREFERRED_CALENDAR_KEY = 'worklog.mobile.preferred-calendar.v1';
const CALENDAR_OPTOUT_KEY = 'worklog.mobile.calendar-optout.v1';
const CALENDAR_INTENT_KEY = 'worklog.mobile.calendar-intents.v1';
// One queue covers sync, move, removal and recovery. Different payloads must NOT
// share the first in-flight result; the later update runs after the earlier one.
let calendarTail: Promise<unknown> = Promise.resolve();
function calendarOperation<T>(run: () => Promise<T>): Promise<T> {
  const task = calendarTail.then(run); calendarTail = task.catch(() => undefined); return task;
}

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

export type CalendarConnectionStatus = Readonly<{
  state: 'connected' | 'permission-required' | 'not-selected' | 'unavailable';
  label: string;
  detail: string;
  calendarId: string | null;
  isGoogle: boolean;
}>;

type CalendarEventCleanup = { calendarId: string; eventId: string; marker?: string; startsAt?: string };
type CalendarEventMapping = Record<string, {
  calendarId: string;
  eventId: string;
  fingerprint: string;
  eventMarker?: string;
  startsAt?: string;
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

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function parseObject(raw: string | null): Record<string, unknown> {
  if (raw === null) return {};
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('캘린더 연결 기록이 손상됐습니다. 기존 이벤트는 변경하지 않았습니다.'); }
  if (!object(value)) throw new Error('캘린더 연결 기록 형식을 확인하지 못했습니다.');
  return value;
}
function parseMappings(raw: string | null): CalendarEventMapping {
  const value = parseObject(raw);
  for (const [sid, item] of Object.entries(value)) {
    if (!sid || ['__proto__', 'constructor', 'prototype'].includes(sid) || !object(item)
      || typeof item.calendarId !== 'string' || !item.calendarId || typeof item.eventId !== 'string' || !item.eventId
      || typeof item.fingerprint !== 'string' || (item.eventMarker !== undefined && typeof item.eventMarker !== 'string')
      || (item.startsAt !== undefined && (typeof item.startsAt !== 'string' || !Number.isFinite(Date.parse(item.startsAt))))
      || (item.pendingCleanup !== undefined && (!Array.isArray(item.pendingCleanup) || item.pendingCleanup.some((v) => !object(v) || typeof v.calendarId !== 'string' || typeof v.eventId !== 'string'
        || (v.startsAt !== undefined && (typeof v.startsAt !== 'string' || !Number.isFinite(Date.parse(v.startsAt)))))))) {
      throw new Error('캘린더 연결 기록을 검증하지 못했습니다. 기존 이벤트는 변경하지 않았습니다.');
    }
  }
  return value as CalendarEventMapping;
}
async function readMappings(): Promise<CalendarEventMapping> {
  return parseMappings(await secureSessionStorage.getItem(CALENDAR_MAPPING_KEY));
}
async function setMapping(sid: string, next: CalendarEventMapping[string] | null) {
  await secureSessionStorage.updateItem(CALENDAR_MAPPING_KEY, (raw) => {
    const value = parseMappings(raw);
    if (next) value[sid] = next; else delete value[sid];
    return JSON.stringify(value);
  });
}

type CalendarIntent = {
  kind: 'create' | 'rollback' | 'remove'; calendarId: string; marker: string;
  schedule: DeviceSchedule; eventId?: string; attempted: boolean;
  obsolete?: CalendarEventCleanup[];
};
async function readIntents(): Promise<Record<string, CalendarIntent>> {
  const value = parseObject(await secureSessionStorage.getItem(CALENDAR_INTENT_KEY));
  for (const [sid, item] of Object.entries(value)) {
    if (!object(item) || !['create', 'rollback', 'remove'].includes(String(item.kind)) || typeof item.calendarId !== 'string'
      || typeof item.marker !== 'string' || !/^worklog-sync:[a-f0-9-]{36}$/.test(item.marker)
      || !object(item.schedule) || item.schedule.scheduleId !== sid || typeof item.schedule.title !== 'string'
      || typeof item.schedule.startsAt !== 'string' || !Number.isFinite(Date.parse(item.schedule.startsAt))
      || typeof item.attempted !== 'boolean'
      || (item.eventId !== undefined && typeof item.eventId !== 'string')
      || (item.obsolete !== undefined && (!Array.isArray(item.obsolete) || item.obsolete.some((e) => !object(e) || typeof e.eventId !== 'string' || typeof e.calendarId !== 'string'
        || (e.startsAt !== undefined && (typeof e.startsAt !== 'string' || !Number.isFinite(Date.parse(e.startsAt)))))))) {
      throw new Error('미완료 캘린더 작업을 확인하지 못했습니다. 자동 재생성하지 않습니다.');
    }
  }
  return value as Record<string, CalendarIntent>;
}
async function setIntent(sid: string, next: CalendarIntent | null) {
  // readIntents validates before this update; all callers share calendarOperation.
  await readIntents();
  await secureSessionStorage.updateItem(CALENDAR_INTENT_KEY, (raw) => {
    const value = parseObject(raw); if (next) value[sid] = next; else delete value[sid]; return JSON.stringify(value);
  });
}

function cleanupKey(value: CalendarEventCleanup) { return `${value.calendarId}:${value.eventId}`; }
async function isOptedOut(sid: string) {
  const value = parseObject(await secureSessionStorage.getItem(CALENDAR_OPTOUT_KEY));
  if (Object.values(value).some((v) => v !== true)) throw new Error('캘린더 연결 해제 설정을 확인하지 못했습니다.');
  return value[sid] === true;
}
async function setOptOut(sid: string, disabled: boolean) {
  await isOptedOut(sid);
  await secureSessionStorage.updateItem(CALENDAR_OPTOUT_KEY, (raw) => {
    const value = parseObject(raw); if (disabled) value[sid] = true; else delete value[sid]; return JSON.stringify(value);
  });
}

function nativeCalendarError(stage: string, error: unknown, message: string) {
  console.warn('[device-calendar]', {
    stage,
    detail: error instanceof Error ? error.message : 'unknown_error',
  });
  return Object.assign(new Error(message), { code: `WORKLOG_CALENDAR_NATIVE_${stage.toUpperCase()}`, causeValue: error });
}

async function findEvent(eventId: string, calendarId?: string, startsAt?: string) {
  // When schedule time is known, prefer a bounded calendar query. This avoids
  // depending on a static SharedObject lookup for the normal sync/cancel path
  // and also verifies that the event still belongs to the expected calendar.
  if (calendarId && startsAt && Number.isFinite(Date.parse(startsAt))) {
    try {
      const calendar = await calendarById(calendarId);
      const anchor = new Date(startsAt);
      const events = await calendar.listEvents(
        new Date(anchor.getTime() - 2 * 86_400_000),
        new Date(anchor.getTime() + 2 * 86_400_000),
      );
      const found = events.find((event) => event.id === eventId);
      if (found) return found;
      // The event may have been moved outside the expected window by the user.
      // Fall through to the ID lookup before declaring it absent.
    } catch (error) {
      throw nativeCalendarError('event_list', error, '캘린더 이벤트 상태를 확인하지 못했습니다. 다시 확인해주세요.');
    }
  }

  try { return await Calendar.ExpoCalendarEvent.get(eventId); }
  catch (error) {
    // Exact native absence only. Permission/DB/read errors must NOT authorize a create/delete.
    if (object(error) && error.code === 'E_EVENT_NOT_FOUND') return null;
    throw nativeCalendarError('event_get', error, '캘린더 이벤트 상태를 확인하지 못했습니다. 다시 확인해주세요.');
  }
}
async function deleteCalendarEvent(eventId: string, calendarId: string, marker?: string, startsAt?: string) {
  const event = await findEvent(eventId, calendarId, startsAt);
  if (!event) return;
  if (event.calendarId !== calendarId || (marker && !event.notes?.split('\n').includes(marker))) {
    throw new Error('캘린더 이벤트의 연결 대상을 확인하지 못해 삭제하지 않았습니다.');
  }
  try { await event.delete(); }
  catch (error) { throw nativeCalendarError('event_delete', error, '캘린더 이벤트를 제거하지 못했습니다. 다시 확인해주세요.'); }
  if (await findEvent(eventId, calendarId, startsAt)) throw new Error('캘린더 이벤트 삭제 결과를 확인하지 못했습니다. 정리 내역을 보존합니다.');
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
  return preferred ? optionOf(preferred) : null; // Discovery never selects a target for the user.
}


export async function readCalendarConnectionStatus(): Promise<CalendarConnectionStatus> {
  const permission = await Calendar.getCalendarPermissions();
  if (!permission.granted) {
    return Object.freeze({
      state: 'permission-required',
      label: '캘린더 권한 필요',
      detail: '설정에서 캘린더 권한을 허용해주세요.',
      calendarId: null,
      isGoogle: false,
    });
  }

  const calendars = (await Calendar.getCalendars())
    .filter((calendar) => calendar.allowsModifications && calendar.isVisible !== false)
    .map(optionOf)
    .sort((left, right) => Number(right.isGoogle) - Number(left.isGoogle) || Number(right.isPrimary) - Number(left.isPrimary) || left.title.localeCompare(right.title, 'ko-KR'));

  if (!calendars.length) {
    return Object.freeze({
      state: 'unavailable',
      label: '사용 가능한 캘린더 없음',
      detail: '휴대폰에 Google 또는 수정 가능한 캘린더를 추가해주세요.',
      calendarId: null,
      isGoogle: false,
    });
  }

  const preferredId = await getPreferredCalendarId();
  const preferred = calendars.find((calendar) => calendar.id === preferredId) || null;
  if (!preferred) {
    const suggested = calendars.find((calendar) => calendar.isGoogle && calendar.isPrimary)
      || calendars.find((calendar) => calendar.isGoogle)
      || calendars.find((calendar) => calendar.isPrimary)
      || calendars[0];
    return Object.freeze({
      state: 'not-selected',
      label: '캘린더 미선택',
      detail: suggested?.isGoogle
        ? `연결 가능: Google Calendar · ${suggested.ownerAccount || suggested.title}`
        : `연결 가능: ${suggested?.title || '휴대폰 캘린더'}`,
      calendarId: null,
      isGoogle: Boolean(suggested?.isGoogle),
    });
  }

  return Object.freeze({
    state: 'connected',
    label: preferred.isGoogle ? 'Google Calendar 연결됨' : '휴대폰 캘린더 연결됨',
    detail: preferred.isGoogle
      ? `${preferred.ownerAccount || preferred.title}${preferred.title && preferred.title !== preferred.ownerAccount ? ` · ${preferred.title}` : ''}`
      : `${preferred.title}${preferred.ownerAccount ? ` · ${preferred.ownerAccount}` : ''}`,
    calendarId: preferred.id,
    isGoogle: preferred.isGoogle,
  });
}

export async function getScheduleCalendarMapping(scheduleId: string) {
  const mappings = await readMappings();
  return mappings[scheduleId] || null;
}

/**
 * Keeps an already-authorized schedule mapping aligned without prompting for
 * Calendar permission. A user who never connected this schedule is untouched.
 */
export function synchronizeMappedScheduleToCalendar(schedule: DeviceSchedule) {
  return calendarOperation(async () => {
    if (await isOptedOut(schedule.scheduleId)) return { updated: false, reason: 'not-connected' as const };
    const mapping = await getScheduleCalendarMapping(schedule.scheduleId);
    if (!mapping) return { updated: false, reason: 'not-connected' as const };
    if (!(await Calendar.getCalendarPermissions()).granted) return { updated: false, reason: 'permission' as const };
    await syncCalendarUnlocked(mapping.calendarId, schedule);
    return { updated: true, reason: 'synced' as const };
  });
}

/** Only explicitly selected targets are used. Selection and side effect share a queue. */
export function synchronizeScheduleToPreferredCalendar(schedule: DeviceSchedule) {
  return calendarOperation(async () => {
    if (!schedule.scheduleId || !schedule.startsAt) return { updated: false, reason: 'invalid-schedule' as const };
    if (await isOptedOut(schedule.scheduleId)) return { updated: false, reason: 'not-connected' as const };
    if (!(await Calendar.getCalendarPermissions()).granted) return { updated: false, reason: 'permission' as const };
    const mapping = await getScheduleCalendarMapping(schedule.scheduleId);
    const preferredId = await getPreferredCalendarId();
    const calendarId = mapping?.calendarId || preferredId;
    if (!calendarId) return { updated: false, reason: 'not-connected' as const };
    const result = await syncCalendarUnlocked(calendarId, schedule);
    return { updated: true, reason: result.created ? 'created' as const : 'synced' as const };
  });
}

/**
 * Returns every schedule for which this device still owns a Calendar event.
 * Startup cancellation recovery uses these durable local references to repair
 * a server-cancelled schedule when the cancellation marker itself was lost.
 */
export async function listTrackedCalendarScheduleIds() {
  return [...new Set([...Object.keys(await readMappings()), ...Object.keys(await readIntents())])];
}

function dates(schedule: DeviceSchedule) {
  const startDate = new Date(schedule.startsAt);
  const endDate = schedule.endsAt ? new Date(schedule.endsAt) : new Date(startDate.getTime() + (schedule.allDay ? 86_400_000 : 3_600_000));
  if (!/^[a-zA-Z0-9._-]{1,200}$/.test(schedule.scheduleId) || ['__proto__', 'constructor', 'prototype'].includes(schedule.scheduleId) || !schedule.title.trim() || !Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || endDate <= startDate) {
    throw new Error('캘린더에 반영할 일정 날짜와 시간을 확인해주세요.');
  }
  return { startDate, endDate };
}
async function calendarById(id: string) {
  if (!(await Calendar.getCalendarPermissions()).granted) throw new Error('캘린더 권한이 필요합니다. 자동으로 권한 요청을 띄우지 않았습니다.');
  const calendars = await Calendar.getCalendars();
  const calendar = calendars.find((c) => c.id === id && c.allowsModifications && c.isVisible !== false);
  if (!calendar) throw new Error('선택한 캘린더를 찾을 수 없습니다. 다른 계정으로 자동 전송하지 않았습니다.');
  return calendar;
}
async function locateIntentEvent(intent: CalendarIntent) {
  if (intent.eventId) {
    const found = await findEvent(intent.eventId, intent.calendarId, intent.schedule.startsAt);
    if (!found) return null;
    if (found.calendarId !== intent.calendarId || !found.notes?.split('\n').includes(intent.marker)) throw new Error('캘린더 작업 식별자가 일치하지 않습니다.');
    return found;
  }
  const calendar = await calendarById(intent.calendarId);
  const { startDate, endDate } = dates(intent.schedule);
  const events = await calendar.listEvents(new Date(startDate.getTime() - 86_400_000), new Date(endDate.getTime() + 86_400_000));
  const owned = events.filter((e) => e.calendarId === intent.calendarId && e.notes?.split('\n').includes(intent.marker));
  if (owned.length > 1) throw new Error('동일한 작업 식별자의 캘린더 이벤트가 여러 개입니다. 자동으로 삭제하지 않았습니다.');
  if (!owned.length && intent.attempted) throw new Error('이전 캘린더 생성 결과를 확인하지 못했습니다. 중복 방지를 위해 재생성을 보류합니다.');
  return owned[0] || null;
}
async function cleanupMapping(sid: string) {
  const mapping = (await readMappings())[sid];
  if (!mapping?.pendingCleanup?.length) return;
  const unresolved: CalendarEventCleanup[] = [];
  for (const cleanup of mapping.pendingCleanup) {
    try { await deleteCalendarEvent(cleanup.eventId, cleanup.calendarId, cleanup.marker, cleanup.startsAt); } catch { unresolved.push(cleanup); }
  }
  await setMapping(sid, { ...mapping, pendingCleanup: unresolved });
  if (unresolved.length) throw new Error('새 캘린더에 반영했지만 이전 이벤트 정리가 남았습니다. 다시 시도해주세요.');
}
async function finishIntent(sid: string) {
  const intent = (await readIntents())[sid];
  if (!intent) return;
  const event = intent.kind === 'remove' && !intent.attempted && !intent.eventId ? null : await locateIntentEvent(intent);
  if (intent.kind === 'remove' || intent.kind === 'rollback') {
    if (event) await deleteCalendarEvent(event.id, intent.calendarId, intent.marker, intent.schedule.startsAt);
    for (const old of intent.obsolete || []) await deleteCalendarEvent(old.eventId, old.calendarId, old.marker, old.startsAt);
    if (intent.kind === 'remove') await setMapping(sid, null);
    await setIntent(sid, null); return;
  }
  if (!event) throw new Error('캘린더 생성 작업이 완료되지 않았습니다.');
  const { startDate, endDate } = dates(intent.schedule);
  if (event.title !== intent.schedule.title || new Date(event.startDate).getTime() !== startDate.getTime()
    || new Date(event.endDate).getTime() !== endDate.getTime() || Boolean(event.allDay) !== Boolean(intent.schedule.allDay)
    || (event.location || '') !== (intent.schedule.location || '')) {
    throw new Error('생성된 캘린더 이벤트 내용이 요청과 다릅니다. 자동으로 완료 처리하지 않습니다.');
  }
  const current = (await readMappings())[sid];
  const option = optionOf(await calendarById(intent.calendarId));
  const old = current?.eventId && current.eventId !== event.id ? [{ calendarId: current.calendarId, eventId: current.eventId, marker: current.eventMarker, startsAt: current.startsAt || intent.schedule.startsAt }] : [];
  const pendingCleanup = [...(current?.pendingCleanup || []), ...old];
  await setMapping(sid, {
    calendarId: intent.calendarId, eventId: event.id, eventMarker: intent.marker, fingerprint: fingerprint(intent.schedule),
    startsAt: intent.schedule.startsAt,
    calendarTitle: option.title, calendarOwnerAccount: option.ownerAccount,
    calendarSourceName: option.sourceName, calendarIsGoogle: option.isGoogle,
    pendingCleanup: [...new Map(pendingCleanup.map((v) => [cleanupKey(v), v])).values()],
  });
  // New mapping and old-event cleanup ownership are durable before deleting anything old.
  await setIntent(sid, null);
  await cleanupMapping(sid);
}

async function syncCalendarUnlocked(calendarId: string, schedule: DeviceSchedule) {
    const { startDate, endDate } = dates(schedule);
    await readMappings(); await readIntents(); // No OS mutation on corrupt metadata.
    await finishIntent(schedule.scheduleId);
    await cleanupMapping(schedule.scheduleId);
    const calendar = await calendarById(calendarId);
    const current = (await readMappings())[schedule.scheduleId];
    if (current?.calendarId === calendarId) {
      const event = await findEvent(current.eventId, current.calendarId, current.startsAt || schedule.startsAt);
      if (event) {
        if (current.eventMarker && !event.notes?.split('\n').includes(current.eventMarker)) throw new Error('이벤트 식별 메모가 변경됐습니다. 자동으로 덮어쓰지 않습니다.');
        if (event.calendarId !== calendarId) throw new Error('연결된 이벤트의 캘린더가 변경됐습니다. 다시 선택해주세요.');
        // Even equal fingerprints must verify the OS event still exists. Updating does not create.
        if (event.title !== schedule.title || new Date(event.startDate).getTime() !== startDate.getTime()
          || new Date(event.endDate).getTime() !== endDate.getTime() || Boolean(event.allDay) !== Boolean(schedule.allDay)
          || (event.location || '') !== (schedule.location || '')) {
          await event.update({ title: schedule.title, startDate, endDate, allDay: Boolean(schedule.allDay), location: schedule.location || '' });
        }
        const verified = await findEvent(current.eventId, current.calendarId, current.startsAt || schedule.startsAt);
        if (!verified || verified.calendarId !== calendarId || verified.title !== schedule.title
          || new Date(verified.startDate).getTime() !== startDate.getTime() || new Date(verified.endDate).getTime() !== endDate.getTime()
          || Boolean(verified.allDay) !== Boolean(schedule.allDay) || (verified.location || '') !== (schedule.location || '')) {
          throw new Error('캘린더의 실제 변경 결과를 확인하지 못했습니다. 다시 시도해주세요.');
        }
        await setMapping(schedule.scheduleId, { ...current, fingerprint: fingerprint(schedule), startsAt: schedule.startsAt });
        return { eventId: current.eventId, created: false };
      }
    }
    const intent: CalendarIntent = { kind: 'create', calendarId, marker: `worklog-sync:${Crypto.randomUUID()}`, schedule: { ...schedule }, attempted: true };
    await setIntent(schedule.scheduleId, intent);
    // A lost create acknowledgement keeps the marker journal; recovery searches by marker, never title/time.
    const event = await calendar.createEvent({ title: schedule.title, startDate, endDate, allDay: Boolean(schedule.allDay), location: schedule.location || '', timeZone: 'Asia/Seoul', notes: intent.marker });
    try {
      await setIntent(schedule.scheduleId, { ...intent, eventId: event.id });
      await finishIntent(schedule.scheduleId);
    } catch (error) {
      const saved = (await readMappings())[schedule.scheduleId];
      if (saved?.eventId !== event.id) {
        // Roll back only when the new mapping was NOT committed and the rollback intent is durable.
        await setIntent(schedule.scheduleId, { ...intent, eventId: event.id, kind: 'rollback' });
        await finishIntent(schedule.scheduleId);
      }
      throw error;
    }
    return { eventId: event.id, created: true };
 }

export function syncScheduleToCalendar(calendarId: string, schedule: DeviceSchedule) {
  return calendarOperation(async () => {
    const result = await syncCalendarUnlocked(calendarId, schedule);
    await setOptOut(schedule.scheduleId, false);
    return result;
  });
}

export function removeScheduleFromCalendar(scheduleId: string, startsAt?: string) {
  return calendarOperation(async () => {
    const mapping = (await readMappings())[scheduleId];
    const pending = (await readIntents())[scheduleId];
    // A deliberate disconnect remains disconnected during later automatic sync.
    await setOptOut(scheduleId, true);
    if (!mapping && !pending) return false;
    if (pending) {
      const obsolete = [...(pending.obsolete || []), ...(mapping ? [{ eventId: mapping.eventId, calendarId: mapping.calendarId, marker: mapping.eventMarker, startsAt: mapping.startsAt || startsAt || pending.schedule.startsAt }, ...(mapping.pendingCleanup || [])] : [])];
      await setIntent(scheduleId, { ...pending, kind: 'remove', obsolete });
      await finishIntent(scheduleId);
    } else if (mapping) {
      // Retain the mapping so a user-initiated removal or cancellation can retry.
      const intent: CalendarIntent = {
        kind: 'remove', calendarId: mapping.calendarId, marker: `worklog-sync:${Crypto.randomUUID()}`,
        schedule: { scheduleId, title: 'Calendar cleanup', startsAt: startsAt || mapping.startsAt || new Date().toISOString() }, attempted: false,
        obsolete: [{ eventId: mapping.eventId, calendarId: mapping.calendarId, marker: mapping.eventMarker, startsAt: mapping.startsAt || startsAt }, ...(mapping.pendingCleanup || [])],
      };
      await setIntent(scheduleId, intent);
      await finishIntent(scheduleId);
    }
    return true;
  });
}

export function reconcileCalendarEventCleanup() {
  return calendarOperation(async () => {
    let cleaned = 0; let remaining = 0;
    const intents = await readIntents(); await readMappings();
    for (const sid of Object.keys(intents)) { try { await finishIntent(sid); cleaned += 1; } catch { remaining += 1; } }
    for (const [sid, mapping] of Object.entries(await readMappings())) {
      if (!mapping.pendingCleanup?.length) continue;
      try { await cleanupMapping(sid); cleaned += 1; } catch { remaining += 1; }
    }
    return { cleaned, remaining };
  });
}
