import test from 'node:test';import assert from 'node:assert/strict';import {isScheduleReminderEligible} from '../netlify/shared/schedule-defer-reminder.mjs';
const schedule={startsAt:'2026-09-17T05:00:00Z',status:'confirmed'};
test('30분 전부터 5분 창 안에서는 알림 대상',()=>assert.equal(isScheduleReminderEligible(schedule,'2026-09-17T04:34:59Z'),true));
test('5분 창이 지나면 알림 대상이 아니다',()=>assert.equal(isScheduleReminderEligible(schedule,'2026-09-17T04:35:00Z'),false));
