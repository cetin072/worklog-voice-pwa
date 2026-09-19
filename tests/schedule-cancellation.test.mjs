import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync('supabase/migrations/20260918023000_cancel_my_schedule_v1.sql', 'utf8');
const mobileCancellation = fs.readFileSync('mobile/src/features/schedule/schedule-cancellation.ts', 'utf8');

test('Schedule cancellation is owner-scoped soft cancellation, never a hard delete', () => {
  assert.match(migration, /create or replace function public\.cancel_my_schedule\(p_schedule_id uuid\)/i);
  assert.match(migration, /security invoker/i);
  assert.match(migration, /w\.owner_user_id = v_user_id/i);
  assert.match(migration, /s\.created_by_user_id = v_user_id/i);
  assert.match(migration, /set status = 'cancelled'/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.schedules/i);
  assert.match(migration, /revoke all on function public\.cancel_my_schedule\(uuid\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.cancel_my_schedule\(uuid\) to authenticated, service_role/i);
});

test('Mobile cancellation records recoverable cleanup only after the server cancellation is confirmed', () => {
  assert.match(mobileCancellation, /PENDING_SCHEDULE_CLEANUP_KEY/);
  assert.match(mobileCancellation, /client\.rpc\('cancel_my_schedule'/);
  const rpc = mobileCancellation.indexOf("client.rpc('cancel_my_schedule'");
  const pending = mobileCancellation.indexOf('updatePendingScheduleIds((ids) => [...ids, scheduleId]);');
  const cleanup = mobileCancellation.indexOf('await cleanupDeviceScheduleArtifacts(scheduleId);');
  assert.ok(rpc >= 0);
  assert.ok(pending > rpc, 'pending cleanup must be saved after a successful server RPC');
  assert.ok(cleanup > pending, 'device cleanup must start only after the confirmed pending marker exists');
  assert.match(mobileCancellation, /removeScheduleFromCalendar\(scheduleId\)/);
  assert.match(mobileCancellation, /cancelAllScheduleReminders\(scheduleId\)/);
  assert.match(mobileCancellation, /reconcileCanceledScheduleArtifacts/);
  assert.match(mobileCancellation, /앱을 다시 열면 자동으로 다시 시도합니다/);
});

test('Startup cancellation recovery verifies Data Core cancellation before cleanup and can recover a lost marker', () => {
  assert.match(mobileCancellation, /listTrackedCalendarScheduleIds/);
  assert.match(mobileCancellation, /listTrackedReminderScheduleIds/);
  assert.match(mobileCancellation, /\.from\('schedules'\)/);
  assert.match(mobileCancellation, /\.eq\('status', 'cancelled'\)/);
  assert.match(mobileCancellation, /a stale marker never authorizes cleanup by itself/);
  const candidates = mobileCancellation.indexOf('const candidateIds =');
  const serverState = mobileCancellation.indexOf(".from('schedules')", candidates);
  const cleanup = mobileCancellation.indexOf('await cleanupDeviceScheduleArtifacts(scheduleId);', serverState);
  assert.ok(candidates >= 0, 'pending and device mappings must both be reconciliation candidates');
  assert.ok(serverState > candidates, 'server state must be read after local candidates are collected');
  assert.ok(cleanup > serverState, 'device cleanup must follow a server cancelled-state check');
});
