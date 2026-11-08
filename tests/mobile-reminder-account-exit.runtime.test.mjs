import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { createScheduleReminderService, REMINDER_OWNER } =
  await import('../mobile/src/features/schedule/schedule-reminder-service.ts');
const NOW = Date.parse('2030-01-01T00:00:00Z');
const SID = '11111111-1111-4111-8111-111111111111';
const LATER = '2030-01-01T10:00:00Z';

function harness() {
  const disk = new Map(), os = new Map(), calls = [];
  let cancelFails = false;
  const storage = {
    async getItem(key) { return disk.get(key) ?? null; },
    async updateItem(key, update) {
      const value = update(disk.get(key) ?? null);
      if (value === null) disk.delete(key); else disk.set(key, value);
      return value;
    },
  };
  const driver = {
    async list() { return [...os.values()].map(item => structuredClone(item)); },
    async permission() { return true; },
    async schedule(value, scheduleId) {
      calls.push(['schedule', scheduleId]);
      os.set(value.identifier, {
        identifier: value.identifier,
        content: { body: value.title, data: {
          owner: REMINDER_OWNER, target: 'schedule', scheduleId,
          offsetMinutes: value.offsetMinutes, triggerAt: value.triggerAt,
        } },
      });
      return value.identifier;
    },
    async cancel(identifier) {
      if (cancelFails) throw new Error('native cancel unavailable');
      calls.push(['cancel', identifier]); os.delete(identifier);
    },
  };
  const service = createScheduleReminderService({ storage, driver, newId: randomUUID, now: () => NOW });
  const entry = (id = SID) => ({ scheduleId: id, title: 'synthetic private event', scheduleStartsAt: LATER, offsetMinutes: 0 });
  return { service, disk, os, calls, entry, failCancel(value) { cancelFails = value; } };
}

test('explicit account exit removes only app-owned native alarms, leaves unrelated notifications and no backend writes', async () => {
  const h = harness();
  await h.service.scheduleReminder(h.entry());
  const orphanId = 'worklog.reminder.v3.orphan';
  h.os.set(orphanId, { identifier: orphanId, content: { body: 'old account', data: {
    owner: REMINDER_OWNER, target: 'schedule', scheduleId: SID, offsetMinutes: 30,
  } } });
  h.os.set('unrelated-1', { identifier: 'unrelated-1',
    content: { body: 'other app', data: { owner: 'unrelated', target: 'other' } } });
  const result = await h.service.clearForAccountExit();
  assert.ok(result.removed >= 2);
  assert.deepEqual([...h.os.keys()], ['unrelated-1']);
  assert.deepEqual(await h.service.listScheduleReminders(SID), []);
  assert.equal((await h.service.getScheduleReminderStatus()).scheduled, 0);
});

test('cancel failure prevents successful exit and retains retryable durable state', async () => {
  const h = harness();
  await h.service.scheduleReminder(h.entry());
  h.failCancel(true);
  await assert.rejects(h.service.clearForAccountExit(), /native cancel unavailable/);
  assert.equal(h.os.size, 1);
  h.failCancel(false);
  await h.service.clearForAccountExit();
  assert.equal(h.os.size, 0);
  assert.deepEqual(await h.service.listScheduleReminders(SID), []);
});

test('a queued save from the old session settles before the serialized exit cleanup', async () => {
  const h = harness();
  const save = h.service.scheduleReminder(h.entry());
  const exit = h.service.clearForAccountExit();
  await Promise.all([save, exit]);
  assert.equal(h.os.size, 0);
  assert.deepEqual(await h.service.listScheduleReminders(SID), []);
});

test('unknown app-tagged notification is fail-closed, not blindly erased', async () => {
  const h = harness();
  h.os.set('worklog.reminder.v3.malformed', {
    identifier: 'worklog.reminder.v3.malformed',
    content: { body: 'legacy', data: { owner: REMINDER_OWNER, target: 'unknown', scheduleId: SID, offsetMinutes: 0 } },
  });
  await assert.rejects(h.service.clearForAccountExit(), /UNKNOWN_ACCOUNT_REMINDER/);
  assert.ok(h.os.has('worklog.reminder.v3.malformed'));
});

test('Platform exits and interactive login paths call native cleanup before auth transition', () => {
  const provider = readFileSync('mobile/src/providers/platform-provider.tsx', 'utf8');
  const home = readFileSync('mobile/app/index.tsx', 'utf8');
  assert.match(provider, /signOut: async \(\) => \{[\s\S]*?await clearDeviceRemindersForAccountExit\(\);[\s\S]*?await client\.auth\.signOut\(\)/);
  assert.match(provider, /signIn: async \(email, password\) => \{[\s\S]*?await clearDeviceRemindersForAccountExit\(\);[\s\S]*?client\.auth\.signInWithPassword/);
  assert.match(provider, /signInWithGoogle: async \(\) => \{[\s\S]*?await clearDeviceRemindersForAccountExit\(\);[\s\S]*?beginGoogleOAuth/);
  assert.match(home, /예약된 업무수첩 일정 알림은 해제되지만/);
  assert.doesNotMatch(provider, /cancelAllScheduledNotificationsAsync/);
});

test('untracked ownerless legacy schedule blocks account publication without erasing unknown OS data', async()=>{
 const h=harness();h.os.set('legacy-untracked',{identifier:'legacy-untracked',content:{data:{target:'schedule',scheduleId:SID,offsetMinutes:0}}});
 await assert.rejects(h.service.clearForAccountExit(),/LEGACY_ACCOUNT_REMINDER_UNVERIFIED/);
 assert.equal(h.os.has('legacy-untracked'),true);
});
