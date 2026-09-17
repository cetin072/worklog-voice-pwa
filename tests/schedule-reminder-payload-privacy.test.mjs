import test from 'node:test';import assert from 'node:assert/strict';import {buildScheduleReminderPayload} from '../netlify/shared/schedule-reminder-content.mjs';
test('Push data에는 kind와 scheduleId만 담는다',()=>{const p=buildScheduleReminderPayload({scheduleId:'s1',title:'회의'});assert.deepEqual(Object.keys(p.data).sort(),['kind','scheduleId']);});
