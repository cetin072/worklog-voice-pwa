import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { register } from 'node:module';
import test from 'node:test';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { createDurableStorage } = await import('../mobile/src/platform/durable-storage.ts');
const { createScheduleReminderService, REMINDER_STATE_KEY, REMINDER_OWNER } = await import(process.env.REMINDER_TEST_SOURCE_URL || new URL('../mobile/src/features/schedule/schedule-reminder-service.ts', import.meta.url).href);
const NOW = Date.parse('2030-01-01T00:00:00Z');
const START = '2030-01-01T06:00:00Z';
const LATER = '2030-01-01T08:00:00Z';
function harness(seed = {}) {
  const disk = new Map(seed.disk); const os = new Map(seed.os); const calls = [];
  let failure = () => {}; let clock = NOW; let allowed = true;
  const native = {
    async getItem(key) { failure('read', key); return disk.get(key) ?? null; },
    async setItem(key, value) { failure('write', key); disk.set(key, value); failure('wrote', key); },
    async removeItem(key) { failure('remove', key); disk.delete(key); },
  };
  const storage = createDurableStorage({ store: native, newGenerationId: () => randomUUID().replaceAll('-', ''), digest: async (s) => createHash('sha256').update(s).digest('hex') });
  const driver = {
    async list() { failure('list'); return [...os.values()].map((r) => structuredClone(r)); },
    async permission(request) { calls.push(['permission', request]); failure('permission'); return allowed; },
    async schedule(r, sid) {
      failure('schedule', r.identifier); calls.push(['schedule', r.identifier]);
      os.set(r.identifier, { identifier: r.identifier, content: { body: r.title, data: { owner: REMINDER_OWNER, target: 'schedule', scheduleId: sid, offsetMinutes: r.offsetMinutes, triggerAt: r.triggerAt } } });
      failure('scheduled', r.identifier); return r.identifier;
    },
    async cancel(id) { failure('cancel', id); calls.push(['cancel', id]); os.delete(id); failure('cancelled', id); },
  };
  const service = createScheduleReminderService({ storage, driver, newId: randomUUID, now: () => clock });
  return { service, storage, disk, os, calls, fail(fn) { failure = fn; }, clock(value) { clock = value; }, allow(value) { allowed = value; }, snapshot() { return { disk, os }; } };
}
const input = (sid = 'schedule-A', start = START, minutes = 30) => ({ scheduleId: sid, title: 'Test meeting', scheduleStartsAt: start, offsetMinutes: minutes });

// These tests execute CURRENT production service + CURRENT durable storage. Only native OS/storage are faked.
test('first registration persists an intent before OS reservation and returns a verified mapping', async () => {
  const h = harness(); let sawIntent = false;
  h.fail((kind) => { if (kind === 'schedule') { sawIntent = [...h.disk.values()].some((v) => typeof v === 'string' && v.includes('"desired"')); } });
  const r = await h.service.scheduleReminder(input());
  assert.equal(sawIntent, true); assert.ok(h.os.has(r.identifier));
  assert.deepEqual(await h.service.listScheduleReminders('schedule-A'), [r]);
});

test('concurrent edits to 20 schedules retain every mapping and OS reservation', async () => {
  const h = harness();
  await Promise.all(Array.from({ length: 20 }, (_, i) => h.service.scheduleReminder(input(`s-${i}`))));
  assert.equal((await h.service.listTrackedReminderScheduleIds()).length, 20); assert.equal(h.os.size, 20);
});

test('same preset is a no-op only while its real OS reservation still exists', async () => {
  const h = harness(); const first = await h.service.scheduleReminder(input());
  assert.equal((await h.service.scheduleReminder(input())).identifier, first.identifier);
  h.os.delete(first.identifier);
  const restored = await h.service.scheduleReminder(input());
  assert.ok(h.os.has(restored.identifier)); assert.equal(h.os.size, 1);
});

test('missing OS reservation is also repaired through synchronize (no early mapping-only skip)', async () => {
  const h = harness(); const r = await h.service.scheduleReminder(input()); h.os.delete(r.identifier);
  const result = await h.service.synchronizeScheduleReminders(input());
  assert.equal(result.failed, 0); assert.equal(h.os.size, 1);
});

test('native schedule success with lost acknowledgement is recovered, not duplicated after restart', async () => {
  const h = harness(); h.fail((kind) => { if (kind === 'scheduled') throw new Error('process stopped'); });
  await assert.rejects(h.service.scheduleReminder(input())); assert.equal(h.os.size, 1);
  const restarted = harness(h.snapshot()); const result = await restarted.service.reconcileScheduleReminders();
  assert.equal(result.failed, 0); assert.equal(result.pending, 0); assert.equal(restarted.os.size, 1);
  assert.equal(restarted.calls.filter(([k]) => k === 'schedule').length, 0);
  assert.equal((await restarted.service.listScheduleReminders('schedule-A')).length, 1);
});

test('mapping persistence fails after native success: intent recovers to one reservation', async () => {
  const h = harness(); let didSchedule = false;
  h.fail((kind, key) => { if (kind === 'scheduled') didSchedule = true; if (didSchedule && kind === 'write' && key.startsWith(REMINDER_STATE_KEY)) throw new Error('disk failed'); });
  await assert.rejects(h.service.scheduleReminder(input())); assert.equal(h.os.size, 1);
  const restarted = harness(h.snapshot()); await restarted.service.reconcileScheduleReminders();
  assert.equal(restarted.os.size, 1); assert.equal((await restarted.service.listScheduleReminders('schedule-A')).length, 1);
});

test('failed replacement cancellation is not reported as success; persisted intent finishes after restart', async () => {
  const h = harness(); const old = await h.service.scheduleReminder(input());
  h.fail((kind, id) => { if (kind === 'cancel' && id === old.identifier) throw new Error('OS unavailable'); });
  const result = await h.service.synchronizeScheduleReminders(input('schedule-A', LATER));
  assert.equal(result.failed, 1); assert.equal((await h.service.listScheduleReminders('schedule-A'))[0].triggerAt, old.triggerAt);
  const restarted = harness(h.snapshot()); const repaired = await restarted.service.reconcileScheduleReminders();
  assert.equal(repaired.failed, 0); assert.equal(restarted.os.size, 1);
  assert.equal((await restarted.service.listScheduleReminders('schedule-A'))[0].triggerAt, '2030-01-01T07:30:00.000Z');
});

test('cancellation supersedes an interrupted replacement; restart cannot recreate either reservation', async () => {
  const h = harness(); await h.service.scheduleReminder(input());
  h.fail((kind) => { if (kind === 'cancel') throw new Error('OS locked'); });
  await assert.rejects(h.service.scheduleReminder(input('schedule-A', LATER)));
  await assert.rejects(h.service.cancelAllScheduleReminders('schedule-A'));
  const restarted = harness(h.snapshot()); await restarted.service.reconcileScheduleReminders();
  assert.equal(restarted.os.size, 0); assert.deepEqual(await restarted.service.listScheduleReminders('schedule-A'), []);
});

test('crash after OS cancellation but before mapping commit never restores cancelled reminder', async () => {
  const h = harness(); await h.service.scheduleReminder(input());
  h.fail((kind) => { if (kind === 'cancelled') throw new Error('process stopped'); });
  await assert.rejects(h.service.cancelScheduleReminder('schedule-A', 30));
  const restarted = harness(h.snapshot()); await restarted.service.reconcileScheduleReminders();
  assert.equal(restarted.os.size, 0); assert.equal(restarted.calls.filter(([k]) => k === 'schedule').length, 0);
});

test('reverse reconciliation matches identifier, removes only owned duplicate, preserves legacy and unrelated notifications', async () => {
  const h = harness(); const r = await h.service.scheduleReminder(input());
  const duplicate = structuredClone(h.os.get(r.identifier)); duplicate.identifier = `worklog.reminder.v3.${randomUUID()}`; h.os.set(duplicate.identifier, duplicate);
  h.os.set('other', { identifier: 'other', content: { body: 'Other', data: { target: 'other' } } });
  h.os.set('legacy-unknown', { identifier: 'legacy-unknown', content: { body: 'Legacy', data: { target: 'schedule', scheduleId: 'schedule-A', offsetMinutes: 30 } } });
  const result = await h.service.reconcileScheduleReminders();
  assert.equal(h.os.has(r.identifier), true); assert.equal(h.os.has(duplicate.identifier), false);
  assert.equal(h.os.has('other'), true); assert.equal(h.os.has('legacy-unknown'), true); assert.equal(result.untracked, 1);
});

test('corrupt v2/v3 mappings are errors and never authorize OS deletion or empty-success', async () => {
  for (const key of ['worklog.mobile.schedule-notifications.v2', REMINDER_STATE_KEY]) {
    const h = harness(); await h.storage.setItem(key, '{broken');
    h.os.set('owned', { identifier: 'worklog.reminder.v3.orphan', content: { data: { owner: REMINDER_OWNER, target: 'schedule', scheduleId: 's', offsetMinutes: 30 } } });
    const before = structuredClone([...h.os]);
    await assert.rejects(h.service.reconcileScheduleReminders()); assert.deepEqual([...h.os], before);
    assert.equal(h.calls.filter(([k]) => ['cancel', 'schedule'].includes(k)).length, 0);
  }
});

test('permission revoked reports synchronization failure and preserves last known reservation', async () => {
  const h = harness(); const first = await h.service.scheduleReminder(input()); h.allow(false);
  const result = await h.service.synchronizeScheduleReminders(input('schedule-A', LATER));
  assert.equal(result.failed, 1); assert.ok(h.os.has(first.identifier));
  assert.deepEqual(h.calls.filter(([k]) => k === 'permission').slice(-1)[0], ['permission', false]);
});

test('legacy mapping and pending cleanup migrate once and preserve original preset', async () => {
  const h = harness(); const old = { identifier: 'old', title: 'Old', triggerAt: '2030-01-01T05:30:00.000Z' };
  await h.storage.setItem('worklog.mobile.schedule-notifications.v1', JSON.stringify({ s: old }));
  h.os.set('old', { identifier: 'old', content: { body: 'Old', data: { target: 'schedule', scheduleId: 's', offsetMinutes: 0 } } });
  const result = await h.service.listScheduleReminders('s'); assert.equal(result[0].offsetMinutes, 0);
  assert.ok(await h.storage.getItem(REMINDER_STATE_KEY));
  await h.service.cancelAllScheduleReminders('s');
  const restarted = harness(h.snapshot()); assert.deepEqual(await restarted.service.listScheduleReminders('s'), []);
});

test('reconcile racing registration/cancellation does not cancel a new in-flight reservation or lose other schedules', async () => {
  const h = harness();
  await Promise.all([h.service.scheduleReminder(input('A')), h.service.reconcileScheduleReminders(), h.service.scheduleReminder(input('B')), h.service.cancelAllScheduleReminders('A')]);
  assert.equal(h.os.size, 1); assert.deepEqual(await h.service.listScheduleReminders('A'), []); assert.equal((await h.service.listScheduleReminders('B')).length, 1);
});

test('past-due interrupted reservation is cancelled, never re-fired immediately', async () => {
  const h = harness(); h.fail((kind) => { if (kind === 'scheduled') throw new Error('stopped'); });
  await assert.rejects(h.service.scheduleReminder(input()));
  const restarted = harness(h.snapshot()); restarted.clock(Date.parse('2030-01-02T00:00:00Z'));
  await restarted.service.reconcileScheduleReminders(); assert.equal(restarted.os.size, 0);
  assert.deepEqual(await restarted.service.listScheduleReminders('schedule-A'), []);
});
