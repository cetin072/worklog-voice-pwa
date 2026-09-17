import test from 'node:test';import assert from 'node:assert/strict';import {isScheduleReminderEligible} from '../netlify/shared/schedule-defer-reminder.mjs';
const now='2026-09-17T04:31:00Z',startsAt='2026-09-17T05:00:00Z';
for(const status of ['cancelled','completed','done','']) test(`${status||'empty'} 상태는 알림 제외`,()=>assert.equal(isScheduleReminderEligible({startsAt,status},now),false));
