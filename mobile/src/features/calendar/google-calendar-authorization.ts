import type { PublicPlatformConfig } from '../../platform/config';
import type { CalendarConnection } from './calendar-connection';
import { createGoogleCalendarAdapter } from './google-calendar-adapter';
import { withRequestDeadline } from '../../platform/request-deadline';

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';
export const CALENDAR_PERMISSION_NOTICE = '선택 사항입니다. Google 권한 자체는 소유 캘린더 일정의 조회·생성·수정·삭제를 허용합니다. 업무수첩은 확인한 한 건 생성·조회만 사용하며 기존 Google 일정을 수정·삭제하지 않습니다. 기본 소유 캘린더(primary)만 지원합니다.';
export type CalendarPkce = { verifier: string; challenge: string };

/** Native Expo Crypto boundary: never Math.random or the SDK's plain fallback. */
export async function createCalendarPkce(randomBytes: () => Promise<Uint8Array>, sha256Base64: (value: string) => Promise<string>): Promise<CalendarPkce> {
  const bytes = await randomBytes();
  if (bytes.length !== 32) throw Error('CALENDAR_CRYPTO_UNAVAILABLE');
  const verifier = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  const challenge = (await sha256Base64(verifier)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) throw Error('CALENDAR_CRYPTO_UNAVAILABLE');
  return { verifier, challenge };
}

/** Public Supabase Auth PKCE protocol, with a native S256 proof. This adapter
 * deliberately never constructs an app/temporary session client or invokes a
 * storage API. JWT/refresh fields in the response are discarded, not installed.
 * SDK 2.116 falls back to weak/plain PKCE when native WebCrypto is absent; using
 * the existing Expo Crypto primitive avoids both that fallback and global shims.
 */
export async function authorizeGoogleCalendar(config: PublicPlatformConfig, callback: string,
  openBrowser: (url: string, redirect: string) => Promise<{ type: string; url?: string }>,
  makePkce: () => Promise<CalendarPkce>, fetchImpl: typeof fetch = fetch,
): Promise<CalendarConnection | null> {
  const boundedFetch: typeof fetch = (url, options) => withRequestDeadline(signal => fetchImpl(url, { ...options, signal }));
  const redirect = `${callback}?purpose=calendar`;
  if (new URL(config.supabaseUrl).protocol !== 'https:') throw Error('CALENDAR_AUTH_FAILED');
  let proof: CalendarPkce;
  try { proof = await makePkce(); } catch { throw Error('CALENDAR_CRYPTO_UNAVAILABLE'); }
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(proof.verifier) || !/^[A-Za-z0-9_-]{43}$/.test(proof.challenge) || proof.verifier === proof.challenge) throw Error('CALENDAR_CRYPTO_UNAVAILABLE');
  const authBase = config.supabaseUrl.replace(/\/$/, '') + '/auth/v1';
  const url = new URL(authBase + '/authorize');
  const params = { provider: 'google', redirect_to: redirect, scopes: `openid email profile ${CALENDAR_SCOPE}`,
    code_challenge: proof.challenge, code_challenge_method: 's256', access_type: 'online', prompt: 'select_account consent' };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const result = await openBrowser(url.toString(), redirect);
  if (result.type === 'cancel' || result.type === 'dismiss') return null;
  if (result.type !== 'success' || !result.url) throw Error('CALENDAR_AUTH_FAILED');
  const returned = new URL(result.url);
  const expected = new URL(redirect);
  if (returned.protocol !== expected.protocol || returned.hostname !== expected.hostname
    || returned.pathname !== expected.pathname || returned.searchParams.get('purpose') !== 'calendar') throw Error('CALENDAR_AUTH_FAILED');
  if (returned.searchParams.get('error') || new URLSearchParams(returned.hash.slice(1)).get('error')) throw Error('CALENDAR_AUTH_DENIED');
  const code = returned.searchParams.get('code');
  if (!code) throw Error('CALENDAR_AUTH_FAILED');
  const exchange = await boundedFetch(authBase + '/token?grant_type=pkce', {
    method: 'POST', headers: { apikey: config.publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ auth_code: code, code_verifier: proof.verifier }),
  });
  if (!exchange.ok) throw Error('CALENDAR_AUTH_FAILED');
  const payload = await exchange.json();
  const token = payload?.provider_token;
  if (typeof token !== 'string' || !token) throw Error('CALENDAR_AUTH_FAILED');
  const response = await boundedFetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw Error('CALENDAR_AUTH_FAILED');
  const identity = await response.json();
  if (typeof identity.id !== 'string' || typeof identity.email !== 'string' || identity.verified_email !== true) throw Error('CALENDAR_AUTH_FAILED');
  const target = { accountId: identity.id, calendarId: 'primary' };
  return { target, email: identity.email, expiresAt: Date.now() + 50 * 60000,
    adapter: createGoogleCalendarAdapter(target, token, fetchImpl) };
}
