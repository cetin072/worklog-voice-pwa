import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScheduleReminderPayload } from '../netlify/shared/schedule-reminder-content.mjs';

test('30분 전 일정 알림은 일정 제목과 고유 tag를 사용한다',()=>{
  const payload=buildScheduleReminderPayload({scheduleId:'abc',title:'보험사 미팅'});
  assert.equal(payload.title,'업무수첩 · 30분 뒤 일정');
  assert.equal(payload.body,'보험사 미팅');
  assert.equal(payload.tag,'worklog-schedule-reminder-abc');
  assert.equal(payload.data.kind,'schedule_advance');
});

test('제목 없는 일정은 알림을 만들지 않는다',()=>assert.equal(buildScheduleReminderPayload({scheduleId:'abc'}),null));
