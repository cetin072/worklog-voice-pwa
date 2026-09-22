import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const sheet = fs.readFileSync('mobile/src/features/work/manual-work-input.tsx', 'utf8');
const home = fs.readFileSync('mobile/app/index.tsx', 'utf8');

test('direct entry only exposes input date time and save', () => {
  assert.match(sheet, />입력<\/Text>/);
  assert.match(sheet, />날짜<\/Text>/);
  assert.match(sheet, />시간<\/Text>/);
  assert.match(sheet, />저장<\/Text>/);
  for (const removed of ['기관', '상태', '유형', '금액', '담당자', '후속조치', '태장', '미래여성가족진흥원']) {
    assert.doesNotMatch(sheet, new RegExp(removed));
  }
});

test('direct entry date and time are folded into canonical save text without exposing legacy metadata controls', () => {
  assert.match(home, /const dueSuffix = manualInput\.dueDate/);
  assert.match(home, /manualInput\.dueTime/);
  assert.match(home, /saveWorklog\(session\.access_token, saveText/);
  assert.doesNotMatch(home.slice(home.indexOf('async function persistDraft()'), home.indexOf('async function changeTaskStatus')), /institutionSource|manualInput\.status|manualInput\.type|manualInput\.amount|manualInput\.assignee|manualInput\.followUp/);
});
