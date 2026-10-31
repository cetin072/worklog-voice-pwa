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
export function resetCalendarConnection() { active?.disconnect(); active = null; owner = ''; }
export function calendarConnection(config: PublicPlatformConfig, userId: string) {
  if (!active || owner !== userId) {
    resetCalendarConnection(); owner = userId;
    active = createCalendarConnection({ authorize: () => authorizeGoogleCalendar(config, MOBILE_AUTH_CALLBACK_URL, WebBrowser.openAuthSessionAsync, nativePkce) });
  }
  return active;
}
