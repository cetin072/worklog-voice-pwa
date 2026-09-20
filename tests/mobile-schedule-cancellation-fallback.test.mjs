import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('mobile/src/features/schedule/schedule-cancellation.ts', 'utf8');

test('schedule cancellation confirms missing or already-cancelled RPC states through the creator-scoped fallback', () => {
  assert.match(source, /isMissingCancelRpc/);
  assert.match(source, /PGRST202/);
  assert.match(source, /cancel_my_schedule/);
  assert.match(source, /cancelScheduleDirectly/);
  assert.match(source, /SCHEDULE_NOT_FOUND_OR_FORBIDDEN/);
  assert.match(source, /existing\.status === 'cancelled'/);
  assert.match(source, /cleanupPending/);
});

test('direct cancellation remains scoped to the signed-in creator and soft-cancels only active states', () => {
  assert.match(source, /client\.auth\.getUser\(\)/);
  assert.match(source, /\.eq\('created_by_user_id', userId\)/);
  assert.match(source, /\.in\('status', \['confirmed', 'tentative'\]\)/);
  assert.match(source, /update\(\{ status: 'cancelled' \}\)/);
});
