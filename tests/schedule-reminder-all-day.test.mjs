import test from 'node:test';import assert from 'node:assert/strict';import {isScheduleReminderEligible} from '../netlify/shared/schedule-defer-reminder.mjs';
test('종일 일정은 30분 전 시각 Push를 만들지 않는다',()=>assert.equal(isScheduleReminderEligible({startsAt:'2026-09-17T05:00:00Z',status:'confirmed',allDay:true},'2026-09-17T04:31:00Z'),false));
