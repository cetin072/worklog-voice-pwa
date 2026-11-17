import type { NativeStringStore } from '../../platform/durable-storage';
import type { CalendarConnection } from './calendar-connection';
import { createGoogleCalendarAdapter } from './google-calendar-adapter';

export type CalendarCredential = {
  target: { accountId: string; calendarId: string }; email: string; expiresAt: number; token: string; refreshToken?: string;
};

/** Dedicated encrypted key; never reuse the application's login session.
 * The native durable store serializes operations per key, including logout
 * racing a save. Absolute expiry is preserved across process restarts.
 */
export function createCalendarCredentialStore(storage: NativeStringStore, project: string, owner: string,
  fetchImpl: typeof fetch = fetch, now = Date.now, renew?: CalendarRenewer) {
  const key = 'worklog_calendar_' + Array.from(`${project}|${owner}`, c => c.charCodeAt(0).toString(16).padStart(4, '0')).join('');
  return {
    save: (credential: CalendarCredential) => storage.setItem(key, JSON.stringify({ version: 1, owner, project, ...credential })),
    clear: () => storage.removeItem(key),
    async restore(): Promise<CalendarConnection | null> {
      const raw = await storage.getItem(key);
      if (!raw) return null;
      let value;
      try { value = JSON.parse(raw); } catch { await storage.removeItem(key); return null; }
      if (value?.version !== 1 || value.owner !== owner || value.project !== project
        || typeof value.token !== 'string' || !value.token || typeof value.email !== 'string'
        || typeof value.target?.accountId !== 'string' || !value.target.accountId || value.target.calendarId !== 'primary'
        || (value.refreshToken !== undefined && (typeof value.refreshToken !== 'string' || !value.refreshToken))
        || !Number.isFinite(value.expiresAt) || (value.expiresAt <= now() && !(value.refreshToken && renew))) {
        await storage.removeItem(key); return null;
      }
      return credentialConnection(value, fetchImpl, credential => storage.setItem(key, JSON.stringify({ version: 1, owner, project, ...credential })), renew);
    },
  };
}

export type CalendarRenewer = (credential: CalendarCredential) => Promise<CalendarCredential>;
export function credentialConnection(credential: CalendarCredential, fetchImpl: typeof fetch,
  save?: (credential: CalendarCredential) => Promise<void>, renew?: CalendarRenewer): CalendarConnection {
  return { target: credential.target, email: credential.email, expiresAt: credential.expiresAt,
    adapter: createGoogleCalendarAdapter(credential.target, credential.token, fetchImpl),
    persist: save ? () => save(credential) : undefined,
    renew: credential.refreshToken && renew ? async () => credentialConnection(await renew(credential), fetchImpl, save, renew) : undefined };
}
