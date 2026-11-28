import { createGoogleCalendarRenewer } from './google-calendar-renewal';
import { secureSessionStorage } from '../../platform/secure-storage';
import { createCalendarCredentialStore } from './calendar-credential-store';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import type { PublicPlatformConfig } from '../../platform/config';
import { MOBILE_AUTH_CALLBACK_URL } from '../../platform/google-auth';
import { createCalendarConnection } from './calendar-connection';
import { authorizeGoogleCalendar, createCalendarPkce, CALENDAR_PERMISSION_NOTICE } from './google-calendar-authorization';

export { CALENDAR_PERMISSION_NOTICE };
const nativeDigest = (value: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value, { encoding: Crypto.CryptoEncoding.BASE64 });
const nativePkce = () => createCalendarPkce(() => Crypto.getRandomBytesAsync(32), nativeDigest);
/** Synthetic native smoke only: public known vector, no Google/browser/storage. */
export async function verifyCalendarNativeCrypto() {
  await nativePkce();
  if (await nativeDigest('abc') !== 'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=') throw Error('CALENDAR_NATIVE_CRYPTO_FAILED');
}
let active: ReturnType<typeof createCalendarConnection> | null = null;
let owner = '';
let sessionTokenForActiveOwner: (() => Promise<string>) | null = null;
export function suspendCalendarConnection() { sessionTokenForActiveOwner = null; active?.suspend(); }
export function resetCalendarConnection() {
  suspendCalendarConnection();
  active?.disconnect(); active = null; owner = '';
}
export function selectCalendarOwner(userId: string | null) {
  if (owner !== (userId || '')) { resetCalendarConnection(); owner = userId || ''; }
  if (active) { active.resume(); void active.restore(); }
}
export function calendarConnection(config: PublicPlatformConfig, userId: string, getSessionToken: () => Promise<string> = async () => '') {
  if (!active || owner !== userId) {
    resetCalendarConnection(); owner = userId;
    const renew = createGoogleCalendarRenewer(userId, () => owner === userId && sessionTokenForActiveOwner ? sessionTokenForActiveOwner() : Promise.resolve(''));
    const store = createCalendarCredentialStore(secureSessionStorage, config.supabaseUrl, userId, fetch, Date.now, renew);
    active = createCalendarConnection({
      authorize: () => authorizeGoogleCalendar(config, MOBILE_AUTH_CALLBACK_URL, WebBrowser.openAuthSessionAsync, nativePkce, fetch, store.save, renew),
      restore: store.restore, clear: store.clear,
    });
  }
  sessionTokenForActiveOwner = getSessionToken;
  return active;
}

