import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { register } from 'node:module';

register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { postponeWorklog, setWorklogAttention, undoPostponeWorklog, undoWorklogAttention } = await import('../mobile/src/platform/worklog-api.ts');
const appSource = readFileSync(new URL('../mobile/app/index.tsx', import.meta.url), 'utf8');
const actionSource = readFileSync(new URL('../mobile/src/features/work/task-reminder-actions.tsx', import.meta.url), 'utf8');

test('mobile reminder API keeps postpone, attention, and undo as distinct authenticated requests', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ ok: true, mode: 'data_core' });
  };
  try {
    await postponeWorklog('session-token', { pageId: 'record-1', dueDate: '2026-09-20', dueTime: '' });
    await setWorklogAttention('session-token', 'record-1', '2026-09-21T09:00:00+09:00');
    await undoPostponeWorklog('session-token', 'record-1');
    await undoWorklogAttention('session-token', 'record-1', '2026-09-21T09:00:00+09:00', '2026-09-19T09:00:00+09:00');
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls.length, 4);
  assert.equal(calls[0].init.headers.authorization, 'Bearer session-token');
  assert.deepEqual(JSON.parse(calls[0].init.body), { action: 'postpone', pageId: 'record-1', dueDate: '2026-09-20', dueTime: '' });
  assert.deepEqual(JSON.parse(calls[1].init.body), { action: 'attention', pageId: 'record-1', nextAttentionAt: '2026-09-21T09:00:00+09:00' });
  assert.deepEqual(JSON.parse(calls[2].init.body), { action: 'undo_postpone', pageId: 'record-1' });
  assert.deepEqual(JSON.parse(calls[3].init.body), {
    action: 'undo_attention',
    pageId: 'record-1',
    expectedAttentionAt: '2026-09-21T09:00:00+09:00',
    previousAttentionAt: '2026-09-19T09:00:00+09:00',
  });
});

test('mobile exposes reminder controls only from task detail and retains home-row completion as the primary action', () => {
  assert.match(appSource, /<TaskReminderActions/);
  assert.match(appSource, /onClearAttention=\{\(\) => void remindSelectedTask\(null\)\}/);
  assert.match(appSource, /undoPostponedTask/);
  assert.match(appSource, /undoTaskAttention/);
  assert.match(appSource, /undoWorklogAttention/);
  assert.match(appSource, /previousAttentionAt: task\.nextAttentionAt \|\| null/);
  assert.match(actionSource, /내일로 미루기/);
  assert.match(actionSource, /다음주로 미루기/);
  assert.match(actionSource, /다시 확인 취소/);
  const taskRow = appSource.slice(appSource.indexOf('function TaskRow'), appSource.indexOf('function NoteRow'));
  assert.match(taskRow, /완료/);
  assert.doesNotMatch(taskRow, /TaskReminderActions|미루기|다시 확인/);
});


test('Human QA mutations acquire the current Supabase session before edit, postpone, attention, and undo requests', () => {
  assert.match(appSource, /getFreshAccessToken/);
  const postpone = appSource.slice(appSource.indexOf('async function postponeSelectedTask'), appSource.indexOf('async function remindSelectedTask'));
  const attention = appSource.slice(appSource.indexOf('async function remindSelectedTask'), appSource.indexOf('async function undoPostponedTask'));
  const undoPostpone = appSource.slice(appSource.indexOf('async function undoPostponedTask'), appSource.indexOf('async function undoTaskAttention'));
  const undoAttention = appSource.slice(appSource.indexOf('async function undoTaskAttention'), appSource.indexOf('async function loadTaskEditorDetails'));
  const editLoad = appSource.slice(appSource.indexOf('async function loadTaskEditorDetails'), appSource.indexOf('function removeVisibleNote'));
  const editSave = appSource.slice(appSource.indexOf('async function saveTaskEditor'), appSource.indexOf('function confirmSignOut'));
  const completion = appSource.slice(appSource.indexOf('async function completeTaskInline'), appSource.indexOf('async function postponeSelectedTask'));

  for (const source of [postpone, attention, undoPostpone, undoAttention, editLoad, editSave, completion]) {
    assert.match(source, /await getFreshAccessToken\(client\)/);
  }
  assert.doesNotMatch(postpone, /session\.access_token/);
  assert.doesNotMatch(attention, /session\.access_token/);
  assert.doesNotMatch(editLoad, /session\.access_token/);
  assert.doesNotMatch(editSave, /session\.access_token/);
});
