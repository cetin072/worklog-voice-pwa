import { createHash, randomUUID as uuid } from 'node:crypto';
import { createDurableStorage } from '../../mobile/src/platform/durable-storage.ts';
let world;
export let secureSessionStorage;
export const randomUUID = uuid;
function step(kind, key) { world.failure(kind, key); }
function absence() { return Object.assign(new Error('event missing'), { code: 'E_EVENT_NOT_FOUND' }); }
function eventObject(id) {
  const row = world.events.get(id); if (!row) throw absence();
  return {
    ...row,
    async update(details) { step('update-event', id); world.calls.push(['update', id]); world.events.set(id, { ...world.events.get(id), ...details }); step('event-updated', id); },
    async delete() { step('delete-event', id); world.calls.push(['delete', id]); world.events.delete(id); step('event-deleted', id); },
  };
}
export const ExpoCalendarEvent = { async get(id) { step('get-event', id); return eventObject(id); } };
export async function getCalendarPermissions() { return { granted: world.allowed }; }
export async function requestCalendarPermissions() { world.calls.push(['request-permission']); return { granted: world.allowed }; }
export async function getCalendars() {
  step('list-calendars');
  return world.calendars.map((row) => ({
    ...row,
    async createEvent(details) {
      step('create-event', row.id); await world.pause('before-create', row.id); const id = uuid(); world.calls.push(['create', id]);
      world.events.set(id, { ...details, id, calendarId: row.id }); step('event-created', id); return eventObject(id);
    },
    async listEvents(start, end) {
      step('list-events', row.id);
      return [...world.events.values()].filter((e) => e.calendarId === row.id && new Date(e.startDate) < end && new Date(e.endDate) > start).map((e) => eventObject(e.id));
    },
  }));
}
export function reset(seed = {}) {
  world = {
    disk: new Map(seed.disk), events: new Map(seed.events), calls: [], failure: () => {}, pause: async () => {}, allowed: true,
    calendars: [{ id: 'work', title: 'Work', ownerAccount: 'test-work', source: { type: 'google' }, isPrimary: true, allowsModifications: true },
      { id: 'personal', title: 'Personal', ownerAccount: 'test-personal', source: { type: 'google' }, isPrimary: false, allowsModifications: true }],
  };
  secureSessionStorage = createDurableStorage({
    store: {
      async getItem(key) { step('read', key); return world.disk.get(key) ?? null; },
      async setItem(key, value) { step('write', key); world.disk.set(key, value); step('wrote', key); },
      async removeItem(key) { step('remove', key); world.disk.delete(key); },
    },
    newGenerationId: () => uuid().replaceAll('-', ''), digest: async (s) => createHash('sha256').update(s).digest('hex'),
  });
  return world;
}
reset();
export const Platform = { OS: 'android' };
export const SchedulableTriggerInputTypes = { DATE: 'date' };
export const AndroidImportance = { HIGH: 4 };
export function setNotificationHandler() { world.calls.push(['handler']); }
export async function setNotificationChannelAsync() {}
export async function getPermissionsAsync() { return { granted: world.allowed }; }
export const requestPermissionsAsync = getPermissionsAsync;
export async function getAllScheduledNotificationsAsync() { step('list-notifications'); return [...(world.notifications || new Map()).values()]; }
export async function scheduleNotificationAsync(request) {
  step('schedule-notification'); world.notifications ||= new Map(); world.notifications.set(request.identifier, request); return request.identifier;
}
export async function cancelScheduledNotificationAsync(identifier) {
  step('cancel-notification', identifier); world.notifications?.delete(identifier);
}
