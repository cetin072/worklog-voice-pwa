import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../supabase/migrations/20260920003428_stage4_final_audit_fixes.sql', import.meta.url), 'utf8');

test('postpone undo is compare-and-swap safe after later due edits', () => {
  assert.match(migration, /'appliedDueAt', p_due_at/);
  assert.match(migration, /'appliedDueTimeExplicit', coalesce\(p_due_has_time, false\)/);
  assert.match(migration, /v_current_due_at is distinct from v_applied_due_at/);
  assert.match(migration, /WORK_RECORD_POSTPONE_UNDO_STALE/);
});

test('attention undo may restore a past previous value but only if the applied value is still current', () => {
  assert.match(migration, /create or replace function public\.undo_my_work_record_attention/);
  assert.match(migration, /v_current_attention_at is distinct from p_expected_attention_at/);
  assert.match(migration, /WORK_RECORD_ATTENTION_UNDO_STALE/);
  assert.match(migration, /set next_attention_at = p_previous_attention_at/);
  assert.doesNotMatch(migration, /p_previous_attention_at <= now\(\)/);
});

test('new undo RPC remains invoker and owner scoped', () => {
  assert.match(migration, /undo_my_work_record_attention[\s\S]*security invoker/i);
  assert.match(migration, /wr\.workspace_id = v_workspace_id/);
  assert.match(migration, /wr\.created_by_user_id = v_user_id/);
  assert.match(migration, /revoke all on function public\.undo_my_work_record_attention[^;]+ from public, anon/i);
  assert.match(migration, /grant execute on function public\.undo_my_work_record_attention[^;]+ to authenticated, service_role/i);
});
