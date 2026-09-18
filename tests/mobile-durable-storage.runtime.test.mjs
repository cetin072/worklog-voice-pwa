import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { register } from 'node:module';
import test from 'node:test';

register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const source = process.env.STORAGE_TEST_SOURCE_URL || new URL('../mobile/src/platform/durable-storage.ts', import.meta.url).href;
const { createDurableStorage, StorageIntegrityError, STORAGE_LIMITS } = await import(source);
const digest = async (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const KEY = 'test.session';
const headKey = `${KEY}__atomic_v1`;
const oldValue = JSON.stringify({ token: 'old'.repeat(1100), user: 'test-user' });
const newValue = JSON.stringify({ token: 'new'.repeat(1800), user: 'test-user' });

function native(initial = new Map()) {
  const disk = new Map(initial);
  const trace = [];
  let before = () => {}; let after = () => {};
  async function op(kind, key, value, perform) {
    const event = { kind, key, value, index: trace.length + 1 };
    trace.push(event); before(event);
    const result = perform(); after(event); return result;
  }
  return {
    disk, trace,
    setBefore(fn) { before = fn; }, setAfter(fn) { after = fn; },
    getItem: (key) => op('get', key, undefined, () => disk.get(key) ?? null),
    setItem: (key, value) => op('set', key, value, () => { disk.set(key, value); }),
    removeItem: (key) => op('remove', key, undefined, () => { disk.delete(key); }),
  };
}
function storage(store, extra = {}) {
  return createDurableStorage({ store, newGenerationId: () => randomBytes(16).toString('hex'), digest, ...extra });
}
async function seeded() { const n = native(); await storage(n).setItem(KEY, oldValue); return new Map(n.disk); }
function activePartKeys(n) {
  const h = JSON.parse(n.disk.get(headKey));
  return Array.from({ length: h.current.chunks }, (_, i) => `${KEY}__atomic_${h.current.id}_${i}`);
}

test('current production storage: short, empty, chunk boundaries, Korean, emoji and 100+ chunks round-trip', async () => {
  const n = native(); const s = storage(n);
  for (const value of ['', 'x', 'x'.repeat(1499), 'x'.repeat(1500), 'x'.repeat(1501), '가🙂'.repeat(800), 'x'.repeat(148501)]) {
    await s.setItem(KEY, value);
    assert.equal(await s.getItem(KEY), value);
    assert.equal(await storage(native(n.disk)).getItem(KEY), value, 'fresh JS instance must read the committed generation');
    for (const k of activePartKeys(n)) assert.ok(Buffer.byteLength(n.disk.get(k), 'utf8') <= STORAGE_LIMITS.chunkBytes);
  }
});

test('all native-operation crash boundaries preserve exactly old OR committed new value after restart', async () => {
  const seed = await seeded();
  const normal = native(seed); await storage(normal).setItem(KEY, newValue);
  for (const mode of ['before', 'after']) {
    for (let cut = 1; cut <= normal.trace.length; cut += 1) {
      const n = native(seed); let off = false;
      n.setBefore((e) => { if (off || (mode === 'before' && e.index === cut)) { off = true; throw new Error('simulated process stopped'); } });
      n.setAfter((e) => { if (mode === 'after' && e.index === cut) { off = true; throw new Error('simulated process stopped'); } });
      await storage(n).setItem(KEY, newValue).catch(() => undefined);
      const restarted = native(n.disk); const fresh = storage(restarted);
      const committed = JSON.parse(restarted.disk.get(headKey)).current.id !== JSON.parse(seed.get(headKey)).current.id;
      assert.equal(await fresh.getItem(KEY), committed ? newValue : oldValue, `${mode} operation ${cut}`);
      await fresh.recover(KEY);
      assert.equal(await fresh.getItem(KEY), committed ? newValue : oldValue);
      assert.equal(restarted.disk.has(`${KEY}__atomic_pending_v1`), false);
      const active = new Set(activePartKeys(restarted));
      for (const key of restarted.disk.keys()) if (/__atomic_[a-f0-9]{32}_\d+$/.test(key)) assert.ok(active.has(key), 'interrupted generation must be cleaned');
    }
  }
});

test('failed part write rejects but preserves old value and the same queue remains usable', async () => {
  const n = native(await seeded()); const s = storage(n);
  let fail = true;
  n.setBefore((e) => { if (fail && e.kind === 'set' && /__atomic_[a-f0-9]{32}_1$/.test(e.key)) throw new Error('native write failed'); });
  await assert.rejects(s.setItem(KEY, newValue));
  assert.equal(await s.getItem(KEY), oldValue);
  fail = false;
  await s.setItem(KEY, newValue); assert.equal(await s.getItem(KEY), newValue);
});

test('readback detects a native truncated write before replacing the old value', async () => {
  const n = native(await seeded()); const s = storage(n);
  n.setAfter((e) => { if (e.kind === 'set' && /__atomic_[a-f0-9]{32}_0$/.test(e.key)) n.disk.set(e.key, e.value.slice(1)); });
  await assert.rejects(s.setItem(KEY, newValue), StorageIntegrityError);
  assert.equal(await s.getItem(KEY), oldValue);
});

test('lost manifest acknowledgement does not delete an already committed generation', async () => {
  const n = native(await seeded()); const s = storage(n); let failed = false;
  n.setAfter((e) => { if (!failed && e.kind === 'set' && e.key === headKey) { failed = true; throw new Error('native acknowledgement lost'); } });
  await s.setItem(KEY, newValue);
  assert.equal(await s.getItem(KEY), newValue);
});

test('post-commit cleanup failure preserves new value and is retried from persisted metadata', async () => {
  const n = native(await seeded()); let pending = 0;
  const s = storage(n, { onMaintenancePending() { pending += 1; } });
  n.setBefore((e) => { if (e.kind === 'remove') throw new Error('cleanup unavailable'); });
  await s.setItem(KEY, newValue);
  assert.equal(await s.getItem(KEY), newValue); assert.equal(pending, 1);
  const restarted = native(n.disk); const fresh = storage(restarted); await fresh.recover(KEY);
  assert.equal(await fresh.getItem(KEY), newValue); assert.deepEqual(JSON.parse(restarted.disk.get(headKey)).garbage, []);
});

test('concurrent writes and reads never mix generations', async () => {
  const n = native(); const s = storage(n);
  const a = JSON.stringify({ kind: 'A', data: 'a'.repeat(4200) });
  const b = JSON.stringify({ kind: 'B', data: 'b'.repeat(2700) });
  const tasks = [s.setItem(KEY, a), s.getItem(KEY), s.setItem(KEY, b), s.getItem(KEY)];
  const results = await Promise.all(tasks);
  assert.equal(results[1], a); assert.equal(results[3], b); assert.equal(await s.getItem(KEY), b);
});

test('atomic updateItem retains both concurrent shared-map edits (not only serialized setItem)', async () => {
  const n = native(); const s = storage(n);
  await Promise.all(Array.from({ length: 30 }, (_, i) => s.updateItem(KEY, (raw) => JSON.stringify({ ...JSON.parse(raw || '{}'), [`schedule-${i}`]: { id: i } }))));
  const result = JSON.parse(await s.getItem(KEY));
  assert.equal(Object.keys(result).length, 30);
  for (let i = 0; i < 30; i += 1) assert.equal(result[`schedule-${i}`].id, i);
});

test('failed update callback preserves prior state and does not poison the queue', async () => {
  const n = native(await seeded()); const s = storage(n);
  await assert.rejects(s.updateItem(KEY, () => { throw new Error('invalid draft'); }));
  assert.equal(await s.getItem(KEY), oldValue);
  await s.updateItem(KEY, () => 'recovered'); assert.equal(await s.getItem(KEY), 'recovered');
});

test('legacy direct/chunked data migrates without loss, including the old 100-chunk read limit', async () => {
  for (const value of ['', 'short', '한글🙂'.repeat(700), 'x'.repeat(148501)]) {
    const disk = new Map();
    if (value.length <= 1500) disk.set(KEY, value);
    else {
      const parts = value.match(/[\s\S]{1,1500}/gu) || [];
      disk.set(`${KEY}__chunkmeta`, JSON.stringify({ chunks: parts.length }));
      parts.forEach((p, i) => disk.set(`${KEY}__chunk_${i}`, p));
    }
    const n = native(disk); const s = storage(n);
    assert.equal(await s.getItem(KEY), value);
    await s.setItem(KEY, value); assert.equal(await s.getItem(KEY), value);
    assert.equal(n.disk.has(KEY), false); assert.equal(n.disk.has(`${KEY}__chunkmeta`), false);
  }
});

test('migration crash boundaries retain the legacy value until the new generation commits', async () => {
  const value = 'legacy token'.repeat(220); const parts = [];
  for (let i = 0; i < value.length; i += 1500) parts.push(value.slice(i, i + 1500));
  const seed = new Map([[`${KEY}__chunkmeta`, JSON.stringify({ chunks: parts.length })], ...parts.map((p, i) => [`${KEY}__chunk_${i}`, p])]);
  const normal = native(seed); await storage(normal).setItem(KEY, newValue);
  for (let cut = 1; cut <= normal.trace.length; cut += 1) {
    const n = native(seed); let off = false;
    n.setBefore(() => { if (off) throw new Error('stopped'); });
    n.setAfter((e) => { if (e.index === cut) { off = true; throw new Error('stopped'); } });
    await storage(n).setItem(KEY, newValue).catch(() => undefined);
    const fresh = storage(native(n.disk));
    assert.equal(await fresh.getItem(KEY), n.disk.has(headKey) ? newValue : value, `migration cut ${cut}`);
  }
});

test('missing/corrupt parts and corrupt metadata throw, not empty/session-null; no destructive recovery on read', async () => {
  for (const corrupt of [
    (n) => n.disk.delete(activePartKeys(n)[0]),
    (n) => n.disk.set(activePartKeys(n)[0], 'corrupt'),
    (n) => n.disk.set(headKey, '{broken'),
    (n) => n.disk.set(headKey, JSON.stringify({ v: 7 })),
  ]) {
    const n = native(await seeded()); corrupt(n); const before = new Map(n.disk);
    await assert.rejects(storage(n).getItem(KEY), StorageIntegrityError);
    assert.deepEqual(n.disk, before);
  }
  const badLegacy = native(new Map([[`${KEY}__chunkmeta`, '{bad'], [KEY, 'stale fallback']]));
  await assert.rejects(storage(badLegacy).getItem(KEY), StorageIntegrityError);
});

test('over-limit values and malformed Unicode reject before altering any existing data', async () => {
  const n = native(await seeded()); const s = storage(n); const before = new Map(n.disk);
  for (const value of ['x'.repeat(STORAGE_LIMITS.maxBytes + 1), '\ud800', 'valid\udfff']) {
    await assert.rejects(s.setItem(KEY, value), StorageIntegrityError); assert.deepEqual(n.disk, before);
  }
  assert.equal(await s.getItem(KEY), oldValue);
});

test('invalid generation ids cannot collide with active data or escape the namespace', async () => {
  const n = native(await seeded()); const id = JSON.parse(n.disk.get(headKey)).current.id;
  for (const candidate of [id, '../other', '', 'z'.repeat(32)]) {
    await assert.rejects(storage(n, { newGenerationId: () => candidate }).setItem(KEY, newValue), StorageIntegrityError);
    assert.equal(await storage(n).getItem(KEY), oldValue);
  }
});

test('explicit logout survives all post-tombstone crash boundaries without restoring an old session', async () => {
  const seed = await seeded(); const normal = native(seed); await storage(normal).removeItem(KEY);
  for (let cut = 1; cut <= normal.trace.length; cut += 1) {
    const n = native(seed); let off = false;
    n.setBefore(() => { if (off) throw new Error('stopped'); });
    n.setAfter((e) => { if (e.index === cut) { off = true; throw new Error('stopped'); } });
    await storage(n).removeItem(KEY).catch(() => undefined);
    const tombstoned = JSON.parse(n.disk.get(headKey)).current === null;
    const fresh = storage(native(n.disk));
    assert.equal(await fresh.getItem(KEY), tombstoned ? null : oldValue, `logout cut ${cut}`);
    if (tombstoned) { await fresh.recover(KEY); assert.equal(await fresh.getItem(KEY), null); }
  }
});

test('logout tombstone prevents legacy fallback even when physical cleanup fails or metadata was corrupt', async () => {
  for (const corrupt of [false, true]) {
    const n = native(new Map([[KEY, 'old legacy session']]));
    if (corrupt) n.disk.set(headKey, '{corrupt');
    n.setBefore((e) => { if (e.kind === 'remove') throw new Error('delete unavailable'); });
    await storage(n).removeItem(KEY);
    assert.equal(await storage(native(n.disk)).getItem(KEY), null);
  }
});

test('queued save then logout then different-account save remains ordered', async () => {
  const n = native(); const s = storage(n);
  const accountB = JSON.stringify({ account: 'B' });
  const [, , loggedOut, , current] = await Promise.all([s.setItem(KEY, oldValue), s.removeItem(KEY), s.getItem(KEY), s.setItem(KEY, accountB), s.getItem(KEY)]);
  assert.equal(loggedOut, null); assert.equal(current, accountB);
  assert.equal(await storage(native(n.disk)).getItem(KEY), accountB);
});

test('valid missing key is null and deleting twice is idempotent', async () => {
  const n = native(); const s = storage(n);
  assert.equal(await s.getItem(KEY), null);
  await s.removeItem(KEY); await s.removeItem(KEY);
  assert.equal(await s.getItem(KEY), null);
});
