import * as WebBrowser from 'expo-web-browser';
import type { PublicPlatformConfig } from '../../platform/config';
import { MOBILE_AUTH_CALLBACK_URL } from '../../platform/google-auth';
import { createCalendarConnection } from './calendar-connection';
import { authorizeGoogleCalendar, CALENDAR_PERMISSION_NOTICE } from './google-calendar-authorization';

export { CALENDAR_PERMISSION_NOTICE };
let active: ReturnType<typeof createCalendarConnection> | null = null;
let owner = '';
export function resetCalendarConnection() { active?.disconnect(); active = null; owner = ''; }
export function calendarConnection(config: PublicPlatformConfig, userId: string) {
  if (!active || owner !== userId) {
    resetCalendarConnection(); owner = userId;
    active = createCalendarConnection({ authorize: () => authorizeGoogleCalendar(config, MOBILE_AUTH_CALLBACK_URL, WebBrowser.openAuthSessionAsync) });
  }
  return active;
}
