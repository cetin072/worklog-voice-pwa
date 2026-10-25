import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { register } from 'node:module';
import test from 'node:test';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { readOwnedReminderSnapshots, createReminderSnapshotReconciler, createReminderSyncEpoch } = await import('../mobile/src/features/schedule/schedule-reminder-snapshot.ts');
const { createScheduleReminderService, REMINDER_OWNER } = await import('../mobile/src/features/schedule/schedule-reminder-service.ts');
const { createScheduleReminderCoordinator } = await import('../mobile/src/features/schedule/schedule-reminder-coordinator.ts');
const SID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const NOW = Date.parse('2030-01-01T00:00:00Z');
function row(overrides = {}) { return { id: SID, created_by_user_id: USER, title: 'test', starts_at: '2030-01-03T10:00:00Z', status: 'confirmed', all_day: false, updated_at: '2030-01-01T00:00:00Z', ...overrides }; }
function clientFor(data, options = {}) {
  let authCalls = 0;
  return {
    auth: { async getUser() { authCalls++; return { data: { user: { id: authCalls > 1 && options.switchUser ? OTHER : USER } }, error: options.authError || null }; } },
    from(table) {
      assert.equal(table, 'schedules');
      return { select(fields, config) {
        assert.ok(fields.includes('created_by_user_id')); assert.ok(fields.includes('updated_at')); assert.deepEqual(config, { count: 'exact' });
        return { in(field, ids) {
          assert.equal(field, 'id'); assert.ok(ids.length <= 100);
          return { async eq(field, userId) {
            assert.equal(field, 'created_by_user_id'); assert.equal(userId, USER);
            if (options.wait) await options.wait();
            return { data, count: options.count === undefined ? data?.length : options.count, error: options.error || null };
          } };
        } };
      } };
    },
  };
}
function harness() {
  let onList, onPermission;
  const disk = new Map(), os = new Map(); const epoch = createReminderSyncEpoch();
  const service = createScheduleReminderService({
    now: () => NOW, newId: randomUUID,
    storage: { async getItem(k) { return disk.get(k) ?? null; }, async updateItem(k, fn) { const v = fn(disk.get(k) ?? null); disk.set(k, v); return v; } },
    driver: {
      async list() { if (onList) await onList(); return [...os.values()]; }, async permission() { if (onPermission) await onPermission(); return true; },
      async schedule(r, scheduleId) { os.set(r.identifier, { identifier: r.identifier, content: { body: r.title, data: { owner: REMINDER_OWNER, target: 'schedule', scheduleId, offsetMinutes: r.offsetMinutes, triggerAt: r.triggerAt } } }); return r.identifier; },
      async cancel(id) { os.delete(id); },
    },
  });
  const coordinator = createScheduleReminderCoordinator({ reminders: service });
  const reconcile = createReminderSnapshotReconciler({ read: readOwnedReminderSnapshots, trackedIds: service.listTrackedReminderScheduleIds, synchronize: coordinator.synchronize, now: () => NOW });
  return { service, os, epoch, setListHook(fn) { onList = fn; }, setPermissionHook(fn) { onPermission = fn; }, run(client, visible = []) { return reconcile(client, visible, epoch.begin()); } };
}
async function seed(h, scheduleId = SID) {
  for (const offsetMinutes of [0, 30, 1440]) await h.service.scheduleReminder({ scheduleId, title: 'test', scheduleStartsAt: '2030-01-03T10:00:00Z', offsetMinutes });
}

test('server cancelled row outside briefing explicitly removes only its owned reservations', async () => {
  const h = harness(); await seed(h); await seed(h, OTHER);
  const untouched = (await h.service.listScheduleReminders(OTHER)).map(r => r.identifier);
  const result = await h.run(clientFor([row({ status: 'cancelled' })]));
  assert.deepEqual(result, { verified: 1, unresolved: 1 });
  assert.equal((await h.service.listScheduleReminders(SID)).length, 0);
  assert.deepEqual([...h.os.keys()], untouched);
});

test('time moved beyond briefing horizon replaces all offsets rather than deleting the schedule', async () => {
  const h = harness(); await seed(h); const old = [...h.os.keys()];
  await h.run(clientFor([row({ starts_at: '2030-04-01T12:00:00Z' })]));
  assert.equal(h.os.size, 3); for (const id of old) assert.equal(h.os.has(id), false);
  assert.deepEqual((await h.service.listScheduleReminders(SID)).map(r => r.triggerAt), ['2030-04-01T12:00:00.000Z', '2030-04-01T11:30:00.000Z', '2030-03-31T12:00:00.000Z']);
});

for (const [name, data, options, pattern] of [
  ['network failure', [], { error: { message: 'network' } }, /UNAVAILABLE/],
  ['truncated response', [row({ status: 'cancelled' })], { count: 2 }, /INCOMPLETE/],
  ['missing count', [row({ status: 'cancelled' })], { count: null }, /INCOMPLETE/],
  ['foreign owner', [row({ created_by_user_id: OTHER, status: 'cancelled' })], {}, /INVALID/],
  ['unexpected ID', [row({ id: OTHER, status: 'cancelled' })], {}, /INVALID/],
  ['duplicate rows', [row(), row()], {}, /INVALID/],
  ['unknown status', [row({ status: 'deleted' })], {}, /INVALID/],
  ['malformed row', [row({ starts_at: null })], {}, /INVALID/],
  ['user switched during fetch', [row({ status: 'cancelled' })], { switchUser: true }, /OWNER_CHANGED/],
  ['unverified user', [row()], { authError: { message: 'offline' } }, /OWNER_UNVERIFIED/],
]) test(`${name} does not mutate any reservation`, async () => {
  const h = harness(); await seed(h); const old = structuredClone([...h.os.values()]);
  await assert.rejects(h.run(clientFor(data, options)), pattern);
  assert.deepEqual([...h.os.values()], old);
});

test('absent rows including hard-deleted/RLS-hidden rows are unresolved, never deletion evidence', async () => {
  const h = harness(); await seed(h); const old = [...h.os.keys()];
  assert.deepEqual(await h.run(clientFor([])), { verified: 0, unresolved: 1 });
  assert.deepEqual([...h.os.keys()], old);
});

for (const changes of [{ status: 'completed' }, { all_day: true }, { starts_at: '2029-12-30T10:00:00Z' }]) test(`explicit inactive/past state removes reservations: ${JSON.stringify(changes)}`, async () => {
  const h = harness(); await seed(h); await h.run(clientFor([row(changes)])); assert.equal(h.os.size, 0);
});

test('older overlapping cancelled response cannot overwrite a newer time edit', async () => {
  const h = harness(); await seed(h);
  let release, started; const pending = new Promise(r => { release = r; }); const ready = new Promise(r => { started = r; });
  const old = h.run(clientFor([row({ status: 'cancelled' })], { wait: async () => { started(); await pending; } }));
  const rejected = assert.rejects(old, /STALE/);
  await ready;
  await h.run(clientFor([row({ starts_at: '2030-02-01T10:00:00Z', updated_at: '2030-01-01T01:00:00Z' })]));
  release(); await rejected;
  assert.equal(h.os.size, 3);
  assert.equal((await h.service.listScheduleReminders(SID))[0].triggerAt, '2030-02-01T10:00:00.000Z');
});

test('older server updated_at cannot roll back a previously applied revision', async () => {
  const h = harness(); await seed(h);
  await h.run(clientFor([row({ updated_at: '2030-01-01T01:00:00Z' })]));
  await assert.rejects(h.run(clientFor([row({ status: 'cancelled' })])), /STALE_REMINDER_REVISION/);
  assert.equal(h.os.size, 3);
});

test('session/local mutation invalidation while a response is pending preserves current reservations', async () => {
  const h = harness(); await seed(h); const old = [...h.os.keys()];
  await assert.rejects(h.run(clientFor([row({ status: 'cancelled' })], { wait: async () => h.epoch.invalidate() })), /STALE/);
  assert.deepEqual([...h.os.keys()], old);
});

test('native queue checks freshness at execution, not only when enqueueing', async () => {
  const h = harness(); await seed(h); const guard = h.epoch.begin();
  const queued = h.service.cancelAllScheduleReminders(SID, guard);
  h.epoch.invalidate();
  await assert.rejects(queued, /STALE/);
  assert.equal(h.os.size, 3);
});


test('invalidation during native list cannot delete or leave a stale cancellation intent for recovery', async () => {
  const h = harness(); await seed(h); const old = [...h.os.keys()]; const guard = h.epoch.begin();
  h.setListHook(async () => { h.setListHook(null); h.epoch.invalidate(); });
  await assert.rejects(h.service.cancelAllScheduleReminders(SID, guard), /STALE/);
  assert.deepEqual([...h.os.keys()], old);
  await h.service.reconcileScheduleReminders();
  assert.deepEqual([...h.os.keys()], old);
});

test('invalidation during permission cannot create a reservation or a replayable stale intent', async () => {
  const h = harness(); const guard = h.epoch.begin();
  h.setPermissionHook(async () => { h.setPermissionHook(null); h.epoch.invalidate(); });
  await assert.rejects(h.service.scheduleReminder({ scheduleId: SID, title: 'test', scheduleStartsAt: '2030-01-03T10:00:00Z', offsetMinutes: 0 }, guard), /STALE/);
  assert.equal(h.os.size, 0);
  await h.service.reconcileScheduleReminders();
  assert.equal(h.os.size, 0);
});

test('installed Supabase client emits exact-count ID/creator scope without date or status filters', async () => {
  const { createRequire } = await import('node:module');
  const requireMobile = createRequire(new URL('../mobile/package.json', import.meta.url));
  const requireRoot = createRequire(new URL('../package.json', import.meta.url));
  assert.equal(requireRoot('./package.json').devDependencies['@supabase/supabase-js'], requireMobile('./package.json').dependencies['@supabase/supabase-js']);
  const { createClient } = requireMobile('@supabase/supabase-js');
  const client = createClient('https://example.supabase.co', 'non-secret-test-placeholder', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (url, init) => {
      const query = new URL(url);
      assert.equal(query.searchParams.get('id'), `in.(${SID})`);
      assert.equal(query.searchParams.get('created_by_user_id'), `eq.${USER}`);
      assert.equal(query.searchParams.has('starts_at'), false);
      assert.equal(query.searchParams.has('status'), false);
      assert.match(new Headers(init.headers).get('prefer'), /count=exact/);
      return new Response(JSON.stringify([row({ status: 'cancelled' })]), { status: 200, headers: { 'content-type': 'application/json', 'content-range': '0-0/1' } });
    } },
  });
  client.auth.getUser = async () => ({ data: { user: { id: USER } }, error: null });
  const result = await readOwnedReminderSnapshots(client, [SID], () => true);
  assert.equal(result.rows[0].status, 'cancelled');
  assert.deepEqual(result.unresolvedIds, []);
});
