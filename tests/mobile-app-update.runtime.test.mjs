import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpdateSession, openUpdateStore } from '../mobile/src/features/startup/app-update-policy.ts';

test('available update is checked once even across concurrent mounts and resumes', async () => {
  let calls = 0;
  const session = createUpdateSession(async () => { calls++; return true; });
  assert.deepEqual(await Promise.all([session.check(), session.check()]), [true, true]);
  session.dismiss();
  assert.equal(session.isDismissed(), true);
  await session.check();
  assert.equal(calls, 1);
  const relaunched = createUpdateSession(async () => true);
  assert.equal(relaunched.isDismissed(), false);
  assert.equal(await relaunched.check(), true);
});

test('no update, offline/rejection, synchronous failure and malformed result stay silent', async () => {
  for (const check of [async () => false, async () => { throw Error('offline'); }, () => { throw Error('missing module'); }, async () => 'true']) {
    assert.equal(await createUpdateSession(check).check(), false);
  }
});

test('hung check times out; late success cannot turn it into a prompt', async () => {
  let resolve;
  const session = createUpdateSession(() => new Promise(r => { resolve = r; }), 5);
  assert.equal(await session.check(), false);
  resolve(true);
  assert.equal(await session.check(), false);
});

test('store app opens directly; unavailable handler falls back to web; both failures surface', async () => {
  const calls = [];
  await openUpdateStore(async url => calls.push(url));
  assert.deepEqual(calls, ['market://details?id=com.cetin072.worklog']);
  calls.length = 0;
  await openUpdateStore(async url => { calls.push(url); if (url.startsWith('market:')) throw Error('no handler'); });
  assert.deepEqual(calls, ['market://details?id=com.cetin072.worklog', 'https://play.google.com/store/apps/details?id=com.cetin072.worklog']);
  await assert.rejects(openUpdateStore(async () => { throw Error('offline'); }), /offline/);
});
