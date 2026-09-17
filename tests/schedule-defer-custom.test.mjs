import test from 'node:test';import assert from 'node:assert/strict';import {deferScheduleTime} from '../netlify/shared/schedule-defer-reminder.mjs';
test('직접 선택 미루기는 사용자가 선택한 시각을 사용한다',()=>assert.equal(deferScheduleTime('2026-09-17T05:00:00Z','custom','2026-11-01T03:00:00Z'),'2026-11-01T03:00:00.000Z'));
test('잘못된 미루기 preset은 거부한다',()=>assert.throws(()=>deferScheduleTime('2026-09-17T05:00:00Z','year'),/지원하지 않는/));
