import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const home = fs.readFileSync('mobile/app/index.tsx', 'utf8');
const api = fs.readFileSync('mobile/src/platform/worklog-api.ts', 'utf8');
const worklog = fs.readFileSync('netlify/functions/worklog.mts', 'utf8');

test('Direct input reuses canonical save and keeps failed text in the input', () => {
  assert.match(home, /async function persistDraft\(\)/);
  assert.match(home, /const original = draft\.trim\(\)/);
  assert.match(home, /await saveWorklog\(session\.access_token, original\)/);
  assert.ok(
    home.indexOf("setDraft('');") > home.indexOf('await saveWorklog(session.access_token, original)'),
    'draft is only cleared after canonical save succeeds',
  );
});

test('Canonical worklog response exposes schedule detection, due time and created schedule id', () => {
  assert.match(worklog, /scheduleDetected:Boolean\(schedule\.matched\)/);
  assert.match(worklog, /scheduleId:String\(result\.dataCore\?\.scheduleId \|\| ""\)/);
  assert.match(worklog, /dueStart:String\(schedule\.dueStart \|\| ""\)/);
  assert.match(api, /scheduleDetected\?: boolean/);
  assert.match(api, /scheduleId\?: string/);
  assert.match(api, /dueStart\?: string/);
});

test('Direct input visibly confirms worklog and schedule creation on Home', () => {
  assert.match(home, /DirectSaveFeedback/);
  assert.match(home, /직접 입력 저장 결과/);
  assert.match(home, /업무 저장 완료/);
  assert.match(home, /일정 생성 완료/);
  assert.match(home, /formatSavedDue/);
  assert.match(home, /setNotificationScheduleId\(feedback\.scheduleId\)/);
  assert.match(home, /setScheduleFocusReason\('created'\)/);
  assert.match(home, /방금 생성된 일정/);
});

test('Quick Voice and direct input share the same schedule result contract', () => {
  assert.match(home, /saved\.scheduleId/);
  assert.match(home, /saved\.scheduleDetected/);
  assert.match(home, /saved\.dueStart/);
  assert.match(home, /setScheduleFocusReason\('created'\)/);
});
