import { createClient } from '@supabase/supabase-js';
import type { PublicPlatformConfig } from '../../platform/config';
import type { CalendarConnection } from './calendar-connection';
import { createGoogleCalendarAdapter } from './google-calendar-adapter';
import { withRequestDeadline } from '../../platform/request-deadline';

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';
export const CALENDAR_PERMISSION_NOTICE = '선택 사항입니다. Google 권한 자체는 소유 캘린더 일정의 조회·생성·수정·삭제를 허용합니다. 업무수첩은 확인한 한 건 생성·조회만 사용하며 기존 Google 일정을 수정·삭제하지 않습니다. 기본 소유 캘린더(primary)만 지원합니다.';
export const CALENDAR_AUTH_OPTIONS = {
  persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
  flowType: 'pkce' as const, storageKey: 'worklog.calendar.ephemeral.v1',
};

/** SDK's persistSession:false uses its own memory storage (including PKCE).
 * No SecureStore, app auth client, refresh request, or application auth listener.
 * Callback fields never escape into logs/errors/UI or durable session storage.
 */
export async function authorizeGoogleCalendar(config: PublicPlatformConfig, callback: string,
  openBrowser: (url: string, redirect: string) => Promise<{ type: string; url?: string }>,
  fetchImpl: typeof fetch = fetch, makeClient: typeof createClient = createClient,
): Promise<CalendarConnection | null> {
  const boundedFetch: typeof fetch = (url, options) => withRequestDeadline(signal => fetchImpl(url, { ...options, signal }));
  const temporary = makeClient(config.supabaseUrl, config.publishableKey, { auth: CALENDAR_AUTH_OPTIONS, global: { fetch: boundedFetch } });
  const redirect = `${callback}?purpose=calendar`;
  try {
    const { data, error } = await temporary.auth.signInWithOAuth({ provider: 'google', options: {
      redirectTo: redirect, skipBrowserRedirect: true, scopes: CALENDAR_SCOPE,
      queryParams: { access_type: 'online', prompt: 'select_account consent' },
    } });
    if (error || !data.url) throw Error('CALENDAR_AUTH_FAILED');
    const result = await openBrowser(data.url, redirect);
    if (result.type === 'cancel' || result.type === 'dismiss') return null;
    if (result.type !== 'success' || !result.url) throw Error('CALENDAR_AUTH_FAILED');
    const returned = new URL(result.url);
    const expected = new URL(redirect);
    if (returned.protocol !== expected.protocol || returned.hostname !== expected.hostname
      || returned.pathname !== expected.pathname || returned.searchParams.get('purpose') !== 'calendar') throw Error('CALENDAR_AUTH_FAILED');
    if (returned.searchParams.get('error') || new URLSearchParams(returned.hash.slice(1)).get('error')) throw Error('CALENDAR_AUTH_DENIED');
    const code = returned.searchParams.get('code');
    if (!code) throw Error('CALENDAR_AUTH_FAILED');
    const exchanged = await temporary.auth.exchangeCodeForSession(code);
    const token = exchanged.data.session?.provider_token;
    if (exchanged.error || !token) throw Error('CALENDAR_AUTH_FAILED');
    const response = await boundedFetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw Error('CALENDAR_AUTH_FAILED');
    const identity = await response.json();
    if (typeof identity.id !== 'string' || typeof identity.email !== 'string' || identity.verified_email !== true) throw Error('CALENDAR_AUTH_FAILED');
    const target = { accountId: identity.id, calendarId: 'primary' };
    // Online grant only. Conservative bounded lifetime; HTTP 401 also expires it.
    return { target, email: identity.email, expiresAt: Date.now() + 50 * 60000,
      adapter: createGoogleCalendarAdapter(target, token, fetchImpl) };
  } finally {
    await temporary.auth.stopAutoRefresh();
    // Dispose clears the ephemeral SDK client; no remote/global signOut.
    await temporary.auth.dispose();
  }
}
