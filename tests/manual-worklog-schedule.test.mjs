import test from 'node:test';
import assert from 'node:assert/strict';
import { worklogSchedule } from '../netlify/shared/manual-worklog-schedule.mjs';
const now = '2026-11-02T09:00:00+09:00';
test('selected Friday beats weekday-like words and recording date; title stays separate', () => {
  const s = worklogSchedule('샘 목금 불참 금 농장일정 가능 확인', now, '2026-11-06', '');
  assert.equal(s.dueStart, '2026-11-06'); assert.equal(s.hasTime, false);
  assert.equal(s.text, '샘 목금 불참 금 농장일정 가능 확인');
});
test('old installed client appended picker date is removed without changing selected date', () => {
  const s = worklogSchedule('담당자 확인 요청 2026년 11월 06일', now, '2026-11-06');
  assert.equal(s.text, '담당자 확인 요청'); assert.equal(s.dueStart, '2026-11-06');
});
test('structured time and old client time are retained; no invented midnight schedule', () => {
  assert.equal(worklogSchedule('확인', now, '2026-11-06', '14:30').dueStart, '2026-11-06T14:30:00+09:00');
  assert.equal(worklogSchedule('확인 2026년 11월 06일 오후 2시 30분', now, '2026-11-06').dueStart, '2026-11-06T14:30:00+09:00');
  assert.throws(() => worklogSchedule('확인', now, '2026-02-30', ''), /존재하지/);
});
test('voice prose still uses the existing parser', () => {
  assert.equal(worklogSchedule('내일 확인', now).dueStart, '2026-11-03');
});
