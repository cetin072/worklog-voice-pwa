import { secureSessionStorage } from '@/src/platform/secure-storage';
import type { PlatformSupabaseClient } from '@/src/platform/supabase';

export const ANDROID_TOUCH_DIRTY_SCHEDULE_ID = 'android-touch-schedule-today';

export function createAndroidTouchCancelledRecoveryClient(): PlatformSupabaseClient {
  return {
    from(table: string) {
      if (table !== 'schedules') throw new Error('Android touch recovery client only supports schedules.');
      return {
        select(_columns: string) {
          return {
            in(_column: string, candidateIds: string[]) {
              return {
                async eq(_statusColumn: string, _status: string) {
                  const matched = candidateIds.includes(ANDROID_TOUCH_DIRTY_SCHEDULE_ID);
                  console.info('[android-touch-recovery] cancelled-server-query', {
                    candidates: candidateIds.length,
                    matched,
                  });
                  return {
                    data: matched ? [{
                      id: ANDROID_TOUCH_DIRTY_SCHEDULE_ID,
                      status: 'cancelled',
                      starts_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
                    }] : [],
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as PlatformSupabaseClient;
}

const CALENDAR_MAPPING_KEY = 'worklog.mobile.calendar-event-mappings.v1';
const PREFERRED_CALENDAR_KEY = 'worklog.mobile.preferred-calendar.v1';
const CALENDAR_INTENT_KEY = 'worklog.mobile.calendar-intents.v1';
const REMINDER_STATE_KEY = 'worklog.mobile.schedule-notifications.v3';

export async function seedAndroidTouchDirtyRecoveryFixture(now = Date.now()) {
  const scheduleId = ANDROID_TOUCH_DIRTY_SCHEDULE_ID;
  const startsAt = new Date(now + 3 * 86_400_000).toISOString();
  const triggerAt = new Date(now + 2 * 86_400_000).toISOString();

  await secureSessionStorage.setItem(PREFERRED_CALENDAR_KEY, 'android-touch-dirty-calendar');
  await secureSessionStorage.setItem(CALENDAR_INTENT_KEY, JSON.stringify({}));
  await secureSessionStorage.setItem(CALENDAR_MAPPING_KEY, JSON.stringify({
    [scheduleId]: {
      calendarId: 'android-touch-dirty-calendar',
      eventId: 'android-touch-dirty-event',
      fingerprint: 'android-touch-dirty',
      startsAt,
      pendingCleanup: [{
        calendarId: 'android-touch-dirty-calendar',
        eventId: 'android-touch-dirty-obsolete-event',
        startsAt,
      }],
    },
  }));

  await secureSessionStorage.setItem(REMINDER_STATE_KEY, JSON.stringify({
    version: 3,
    reminders: {
      [scheduleId]: {
        '30': {
          identifier: 'worklog.reminder.v3.android-touch-dirty',
          triggerAt,
          title: 'Android touch dirty reminder',
          offsetMinutes: 30,
        },
      },
    },
    intents: {},
    legacyCleanup: {},
  }));

  console.info('[android-touch-recovery] dirty-device fixture seeded', { scheduleId });
  return Object.freeze({ scheduleId, startsAt, triggerAt });
}
