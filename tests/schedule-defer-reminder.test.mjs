import test from 'node:test';
import assert from 'node:assert/strict';
import { deferScheduleTime, scheduleReminderAt, isScheduleReminderEligible, SCHEDULE_DEFER_PRESETS } from '../netlify/shared/schedule-defer-reminder.mjs';

test('미루기 선택지는 1일/1주/15일/1개월/직접선택이다', () => {
  assert.deepEqual(SCHEDULE_DEFER_PRESETS.map(x => x.label), ['1일 뒤','1주 뒤','15일 뒤','1개월 뒤','날짜 직접 선택']);
});

test('일정 미루기는 기존 시각을 보존해 날짜를 이동한다', () => {
  const start='2026-09-17T05:00:00.000Z';
  assert.equal(deferScheduleTime(start,'day'),'2026-09-18T05:00:00.000Z');
  assert.equal(deferScheduleTime(start,'week'),'2026-09-24T05:00:00.000Z');
  assert.equal(deferScheduleTime(start,'fortnight'),'2026-10-02T05:00:00.000Z');
});

test('30분 전 알림 시각을 계산한다', () => {
  assert.equal(scheduleReminderAt('2026-09-17T05:00:00.000Z'),'2026-09-17T04:30:00.000Z');
});

test('완료/종일/지난 일정은 30분 알림 대상이 아니다', () => {
  const now='2026-09-17T04:31:00.000Z';
  assert.equal(isScheduleReminderEligible({startsAt:'2026-09-17T05:00:00.000Z',status:'confirmed'},now),true);
  assert.equal(isScheduleReminderEligible({startsAt:'2026-09-17T05:00:00.000Z',status:'completed'},now),false);
  assert.equal(isScheduleReminderEligible({startsAt:'2026-09-17T05:00:00.000Z',status:'confirmed',allDay:true},now),false);
  assert.equal(isScheduleReminderEligible({startsAt:'2026-09-17T04:00:00.000Z',status:'confirmed'},now),false);
});
