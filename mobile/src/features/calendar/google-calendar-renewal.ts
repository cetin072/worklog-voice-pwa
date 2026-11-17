import { getApiBaseUrl } from '../../platform/config';
import { withRequestDeadline } from '../../platform/request-deadline';
import type { CalendarRenewer } from './calendar-credential-store';

/** The Web OAuth client secret stays on our server. Google refresh credentials
 * live only in the owner's encrypted device store, never in the app session. */
export function createGoogleCalendarRenewer(owner: string, getSessionToken: () => Promise<string>,
  fetchImpl: typeof fetch = fetch, baseUrl = getApiBaseUrl()): CalendarRenewer {
  return async credential => {
    const appToken = await getSessionToken();
    if (!appToken) throw Error('CALENDAR_APP_LOGIN_REQUIRED');
    const response = await withRequestDeadline(signal => fetchImpl(`${baseUrl}/api/google-calendar-refresh`, {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${appToken}` },
      body: JSON.stringify({ ownerId: owner, accountId: credential.target.accountId, refreshToken: credential.refreshToken }),
    }));
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const allowed = ['CALENDAR_REAUTH_REQUIRED', 'CALENDAR_REFRESH_NOT_CONFIGURED', 'CALENDAR_APP_LOGIN_REQUIRED'];
      throw Error(allowed.includes(result.error) ? result.error : 'CALENDAR_REFRESH_FAILED');
    }
    if (result.accountId !== credential.target.accountId || typeof result.accessToken !== 'string' || !result.accessToken
      || !Number.isFinite(result.expiresIn) || result.expiresIn <= 60) throw Error('CALENDAR_REFRESH_FAILED');
    return { ...credential, token: result.accessToken, expiresAt: Date.now() + (result.expiresIn - 60) * 1000,
      refreshToken: typeof result.refreshToken === 'string' && result.refreshToken ? result.refreshToken : credential.refreshToken };
  };
}
