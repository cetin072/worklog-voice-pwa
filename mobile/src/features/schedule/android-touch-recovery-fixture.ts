import * as Calendar from 'expo-calendar';

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
  const endsAt = new Date(now + 3 * 86_400_000 + 3_600_000).toISOString();
  const obsoleteStartsAt = new Date(now + 2 * 86_400_000).toISOString();
  const obsoleteEndsAt = new Date(now + 2 * 86_400_000 + 3_600_000).toISOString();
  const triggerAt = new Date(now + 2 * 86_400_000).toISOString();
  const eventMarker = 'worklog-sync:11111111-1111-4111-8111-111111111111';
  const obsoleteMarker = 'worklog-sync:22222222-2222-4222-8222-222222222222';

  const calendar = await Calendar.createCalendar({
    title: 'Worklog Android Touch QA',
    color: '#275daf',
    entityType: Calendar.EntityTypes.EVENT,
  });
  const event = await calendar.createEvent({
    title: 'Android touch dirty calendar event',
    startDate: startsAt,
    endDate: endsAt,
    allDay: false,
    notes: eventMarker,
    timeZone: 'Asia/Seoul',
  });
  const obsoleteEvent = await calendar.createEvent({
    title: 'Android touch obsolete cleanup event',
    startDate: obsoleteStartsAt,
    endDate: obsoleteEndsAt,
    allDay: false,
    notes: obsoleteMarker,
    timeZone: 'Asia/Seoul',
  });

  await secureSessionStorage.setItem(PREFERRED_CALENDAR_KEY, calendar.id);
  await secureSessionStorage.setItem(CALENDAR_INTENT_KEY, JSON.stringify({}));
  await secureSessionStorage.setItem(CALENDAR_MAPPING_KEY, JSON.stringify({
    [scheduleId]: {
      calendarId: calendar.id,
      eventId: event.id,
      eventMarker,
      fingerprint: 'android-touch-dirty',
      startsAt,
      pendingCleanup: [{
        calendarId: calendar.id,
        eventId: obsoleteEvent.id,
        marker: obsoleteMarker,
        startsAt: obsoleteStartsAt,
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

  console.info('[android-touch-recovery] native-calendar fixture seeded', {
    scheduleId,
    calendarCreated: Boolean(calendar.id),
    eventCreated: Boolean(event.id),
    obsoleteEventCreated: Boolean(obsoleteEvent.id),
  });
  console.info('[android-touch-recovery] dirty-device fixture seeded', { scheduleId });
  return Object.freeze({ scheduleId, startsAt, triggerAt });
}
