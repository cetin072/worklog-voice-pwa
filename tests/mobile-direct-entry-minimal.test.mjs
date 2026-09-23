import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { isTimedScheduleIntent } from '../netlify/shared/action-engine-v1.mjs';
import { extractScheduleFromText } from '../netlify/shared/schedule-extract.mjs';

const sheet = fs.readFileSync('mobile/src/features/work/manual-work-input.tsx', 'utf8');
const home = fs.readFileSync('mobile/app/index.tsx', 'utf8');

test('direct entry only exposes input date time and save', () => {
  assert.match(sheet, />입력<\/Text>/);
  assert.match(sheet, />날짜<\/Text>/);
  assert.match(sheet, />시간<\/Text>/);
  assert.match(sheet, /: '저장'}/);
  for (const removed of ['기관', '상태', '유형', '금액', '담당자', '후속조치', '태장', '미래여성가족진흥원']) {
    assert.doesNotMatch(sheet, new RegExp(removed));
  }
});

test('direct entry date and time are folded into canonical save text without exposing legacy metadata controls', () => {
  assert.match(home, /function manualScheduleText\(dueDate: string, dueTime: string\)/);
  assert.match(home, /\$1년 \$2월 \$3일/);
  assert.match(home, /meridiem = hour < 12 \? '오전' : '오후'/);
  assert.match(home, /displayHour = hour % 12 \|\| 12/);
  assert.match(home, /manualInput\.dueTime/);
  assert.match(home, /saveWorklog\(session\.access_token, saveText/);
  const save = home.slice(home.indexOf('async function persistDraft()'), home.indexOf('async function changeTaskStatus'));
  assert.match(save, /type: '회의·통화'/);
  assert.doesNotMatch(save, /institutionSource|manualInput\.status|manualInput\.type|manualInput\.amount|manualInput\.assignee|manualInput\.followUp/);
});

test('the existing schedule parser receives picker dates and times in its canonical Korean grammar', () => {
  const dateOnly = extractScheduleFromText('업무 정리 2026년 9월 25일', '2026-09-23T00:00:00.000Z');
  assert.equal(dateOnly.dueStart, '2026-09-25');

  const timed = extractScheduleFromText('업무 회의 2026년 9월 25일 14시 30분', '2026-09-23T00:00:00.000Z');
  assert.equal(timed.dueStart, '2026-09-25T14:30:00+09:00');
  assert.equal(isTimedScheduleIntent({ source: '업무 회의 2026년 9월 25일 14시 30분', dueStart: timed.dueStart, explicitType: '회의·통화' }), true);

  const morning = extractScheduleFromText('알림테스트 2026년 9월 25일 오전 8시 58분', '2026-09-23T00:00:00.000Z');
  assert.equal(morning.dueStart, '2026-09-25T08:58:00+09:00');
  assert.equal(morning.text, '알림테스트');
  assert.equal(isTimedScheduleIntent({ source: '알림테스트 2026년 9월 25일 오전 8시 58분', dueStart: morning.dueStart, explicitType: '회의·통화' }), true);
});
