import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { createCalendarConnection } = await import('../mobile/src/features/calendar/calendar-connection.ts');
const { createCalendarCredentialStore } = await import('../mobile/src/features/calendar/calendar-credential-store.ts');
const credential = { target: { accountId: 'google-one', calendarId: 'primary' }, email: 'test@example.invalid', expiresAt: 100, token: 'synthetic-token' };
function harness() {
  const data = new Map();
  const storage = { getItem: async key => data.get(key) ?? null, setItem: async (key, value) => { data.set(key, value); }, removeItem: async key => { data.delete(key); } };
  const store = createCalendarCredentialStore(storage, 'project', 'owner', fetch, () => 0);
  const service = () => createCalendarConnection({ authorize: async () => ({ ...credential, adapter: {}, persist: () => store.save(credential) }), restore: store.restore, clear: store.clear, now: () => 0 });
  return { data, storage, store, service };
}
test('new runtime restores same account without browser and keeps original expiry; disconnect removes credential', async () => {
  const h = harness(); await h.service().connect();
  const restarted = h.service(); await restarted.restore();
  assert.equal(restarted.info().email, credential.email);
  assert.ok(!JSON.stringify(restarted.info()).includes(credential.token));
  assert.equal((await h.store.restore()).expiresAt, 100);
  restarted.disconnect(); await Promise.resolve();
  const next = h.service(); await next.restore(); assert.equal(next.info(), null);
});
test('different app owner/project cannot restore; corrupt and expired records are cleared', async () => {
  const h = harness(); await h.store.save(credential);
  for (const [project, owner] of [['project', 'other'], ['other', 'owner']]) {
    assert.equal(await createCalendarCredentialStore(h.storage, project, owner, fetch, () => 0).restore(), null);
  }
  assert.equal(await createCalendarCredentialStore(h.storage, 'project', 'owner', fetch, () => 101).restore(), null);
  assert.equal(h.data.size, 0);
  await h.store.save(credential); h.data.set([...h.data.keys()][0], '{broken');
  assert.equal(await h.store.restore(), null); assert.equal(h.data.size, 0);
});
test('logout during restore or save cannot resurrect the connection', async () => {
  let finish;
  const service = createCalendarConnection({ authorize: async () => null, restore: () => new Promise(resolve => { finish = resolve; }), now: () => 0 });
  const pending = service.restore(); service.disconnect(); finish({ ...credential, adapter: {} }); await pending;
  assert.equal(service.info(), null);
  const h = harness(); let finishSave;
  const saving = createCalendarConnection({ authorize: async () => ({ ...credential, adapter: {}, persist: () => new Promise(resolve => { finishSave = resolve; }) }), now: () => 0 });
  const attempt = saving.connect(); await Promise.resolve(); saving.disconnect(); finishSave();
  assert.equal(await attempt, false); assert.equal(saving.info(), null);
});
test('storage failure reports failure instead of claiming a persistent connection', async () => {
  const service = createCalendarConnection({ authorize: async () => ({ ...credential, adapter: {}, persist: async () => { throw Error('storage unavailable'); } }), now: () => 0 });
  await assert.rejects(service.connect()); assert.equal(service.info(), null);
});
