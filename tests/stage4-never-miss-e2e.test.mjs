import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { selectResurfaceTasks } from '../netlify/shared/resurface-engine.mjs';

const migration = readFileSync(new URL('../supabase/migrations/20260919163909_stage4_postpone_remind.sql', import.meta.url), 'utf8');
const task = (values = {}) => ({ pageId: 'task-1', title: '계약서 확인', status: '진행중', actionKind: 'task', dueKey: '2026-09-20', ...values });
const focus = (tasks, now = '2026-09-20T09:00:00.000Z', today = '2026-09-20') => selectResurfaceTasks(tasks, { now, today });

test('today and overdue work disappear from Never Miss immediately when completed', () => {
  assert.equal(focus([task()])[0].reason, 'today');
  assert.equal(focus([task({ dueKey: '2026-09-18' })])[0].reason, 'overdue');
  assert.deepEqual(focus([task({ status: '완료' }), task({ status: '완료', dueKey: '2026-09-18' })]), []);
});

test('future attention preserves due date, stays quiet until due, then resurfaces including waiting work', () => {
  const future = task({ dueKey: '2026-10-01', nextAttentionAt: '2026-09-21T09:00:00.000Z' });
  assert.deepEqual(focus([future]), []);
  assert.deepEqual(focus([future], '2026-09-21T09:00:00.000Z', '2026-09-21').map((item) => [item.reason, item.dueKey]), [['attention', '2026-10-01']]);
  const waiting = task({ status: '대기', dueKey: '', nextAttentionAt: '2026-09-21T09:00:00.000Z' });
  assert.deepEqual(focus([waiting]), []);
  assert.equal(focus([waiting], '2026-09-21T09:00:00.000Z', '2026-09-21')[0].reason, 'attention');
});

test('future explicit attention suppresses today and overdue focus until the chosen attention time', () => {
  const futureAttention = '2026-09-21T09:00:00.000Z';
  assert.deepEqual(focus([task({ dueKey: '2026-09-20', nextAttentionAt: futureAttention })]), []);
  assert.deepEqual(focus([task({ dueKey: '2026-09-18', nextAttentionAt: futureAttention })]), []);
  assert.equal(focus([task({ dueKey: '2026-09-18', nextAttentionAt: futureAttention })], futureAttention, '2026-09-21')[0].reason, 'attention');
});

test('postpone, undo, attention undo, ownership, and linked schedules stay fail-closed at the trusted SQL boundary', () => {
  assert.match(migration, /set due_at = p_due_at/);
  assert.match(migration, /stage4Postpone/);
  assert.match(migration, /set due_at = v_previous_due_at/);
  assert.match(migration, /set next_attention_at = p_next_attention_at/);
  assert.match(migration, /previous_attention_at_value/);
  assert.match(migration, /wr\.workspace_id = v_workspace_id/);
  assert.match(migration, /wr\.created_by_user_id = v_user_id/);
  assert.match(migration, /WORK_RECORD_POSTPONE_SCHEDULE_LINKED/);
  assert.match(migration, /status in \('in_progress', 'waiting', 'needs_review'\)/);
});

