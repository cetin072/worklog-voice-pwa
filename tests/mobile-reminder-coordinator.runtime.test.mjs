import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { register } from 'node:module';
import test from 'node:test';

register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { createScheduleReminderService, REMINDER_OWNER } = await import(new URL('../mobile/src/features/schedule/schedule-reminder-service.ts', import.meta.url).href);
const { createScheduleReminderCoordinator } = await import(new URL('../mobile/src/features/schedule/schedule-reminder-coordinator.ts', import.meta.url).href);

const NOW = Date.parse('2030-01-01T00:00:00Z');
const SID = '11111111-1111-4111-8111-111111111111';

function harness() {
  const disk = new Map(); const os = new Map(); let cancelFails = false; let scheduleFails = false;
  const storage = {
    async getItem(key) { return disk.get(key) ?? null; },
    async updateItem(key, update) { const next = update(disk.get(key) ?? null); if (next === null) disk.delete(key); else disk.set(key, next); return next; },
  };
  const driver = {
    async list() { return [...os.values()].map((value) => structuredClone(value)); },
    async permission() { return true; },
    async schedule(reminder, scheduleId) {
      if (scheduleFails) throw new Error('java.lang.SecurityException: SCHEDULE_EXACT_ALARM denied');
      os.set(reminder.identifier, { identifier: reminder.identifier, content: { body: reminder.title, data: { owner: REMINDER_OWNER, target: 'schedule', scheduleId, offsetMinutes: reminder.offsetMinutes, triggerAt: reminder.triggerAt } } });
      return reminder.identifier;
    },
    async cancel(identifier) { if (cancelFails) throw new Error('temporary OS failure'); os.delete(identifier); },
  };
  const reminders = createScheduleReminderService({ storage, driver, newId: randomUUID, now: () => NOW });
  const coordinator = createScheduleReminderCoordinator({ reminders });
  return { coordinator, reminders, os, failCancel(value) { cancelFails = value; }, failSchedule(value) { scheduleFails = value; } };
}

function active(overrides = {}) {
  return { id: SID, title: '고객 미팅', startsAt: '2030-01-01T10:00:00Z', status: 'confirmed', ...overrides };
}

test('server-confirmed create schedules exactly one start-time reminder and idempotent replay stays one', async () => {
  const h = harness();
  await h.coordinator.synchronize(active());
  await h.coordinator.synchronize(active());
  assert.equal(h.os.size, 1);
  assert.equal((await h.reminders.listScheduleReminders(SID))[0].offsetMinutes, 0);
});

test('confirmed edit replaces 10:00 with exactly one 11:00 reminder', async () => {
  const h = harness();
  await h.coordinator.synchronize(active());
  await h.coordinator.synchronize(active({ startsAt: '2030-01-01T11:00:00Z' }));
  const reminders = await h.reminders.listScheduleReminders(SID);
  assert.equal(h.os.size, 1);
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].triggerAt, '2030-01-01T11:00:00.000Z');
});

test('a multi-action save schedules every confirmed target exactly once', async () => {
  const h = harness(); const second = '22222222-2222-4222-8222-222222222222';
  await h.coordinator.synchronizeMany([active(), active({ id: second, title: '두 번째 미팅', startsAt: '2030-01-01T12:00:00Z' })]);
  assert.equal(h.os.size, 2);
  assert.equal((await h.reminders.listScheduleReminders(SID)).length, 1);
  assert.equal((await h.reminders.listScheduleReminders(second)).length, 1);
});

test('cancelled, removed, and date-only snapshots cannot leave an exact-time reminder', async () => {
  const h = harness();
  await h.coordinator.synchronize(active());
  await h.coordinator.synchronize(active({ status: 'cancelled' }));
  assert.equal(h.os.size, 0);
  await h.coordinator.synchronize(active({ startsAt: '2030-01-02' }));
  assert.equal(h.os.size, 0);
  await h.coordinator.synchronize(null);
  assert.equal(h.os.size, 0);
});

test('a server save failure has no confirmed snapshot and creates no notification', async () => {
  const h = harness();
  await h.coordinator.synchronizeMany([]);
  assert.equal(h.os.size, 0);
});

test('server-confirmed delete removes the owned reminder', async () => {
  const h = harness();
  await h.coordinator.synchronize(active());
  await h.coordinator.cancelConfirmed([SID]);
  assert.equal(h.os.size, 0);
});

test('interrupted replacement converges through existing reminder reconciliation', async () => {
  const h = harness();
  await h.coordinator.synchronize(active());
  h.failCancel(true);
  await assert.rejects(h.coordinator.synchronize(active({ startsAt: '2030-01-01T11:00:00Z' })));
  h.failCancel(false);
  const result = await h.coordinator.recover();
  assert.equal(result.reminders.failed, 0);
  assert.equal(h.os.size, 1);
  assert.equal((await h.reminders.listScheduleReminders(SID))[0].triggerAt, '2030-01-01T11:00:00.000Z');
});

test('startup recovery runs durable reminder and server-confirmed cancellation recovery together', async () => {
  const calls = [];
  const coordinator = createScheduleReminderCoordinator({ reminders: {
    async scheduleReminder() {}, async cancelAllScheduleReminders() {}, async reconcileScheduleReminders() { calls.push('reminders'); return { failed: 0 }; },
  } });
  await coordinator.recover({ async reconcileCanceledScheduleArtifacts() { calls.push('cancellations'); return { remaining: 0 }; } });
  assert.deepEqual(calls, ['reminders', 'cancellations']);
});


test('exact-alarm scheduling failure stays durable and is visible as pending', async () => {
  const h = harness();
  h.failSchedule(true);
  await assert.rejects(h.coordinator.synchronize(active()), /SCHEDULE_EXACT_ALARM/);
  assert.deepEqual(await h.reminders.getScheduleReminderStatus(), { scheduled: 0, pending: 1, cleanupPending: 0 });
  h.failSchedule(false);
  const recovered = await h.coordinator.recover();
  assert.equal(recovered.reminders.failed, 0);
  assert.deepEqual(await h.reminders.getScheduleReminderStatus(), { scheduled: 1, pending: 0, cleanupPending: 0 });
  assert.equal(h.os.size, 1);
});
