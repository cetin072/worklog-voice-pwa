import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { createSerialTaskQueue } = await import('../mobile/src/platform/serial-task-queue.ts');

test('serial task queue never drops a later refresh while an earlier refresh is running', async () => {
  const queue = createSerialTaskQueue();
  const trace = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });

  const first = queue.run(async () => {
    trace.push('first:start');
    await firstGate;
    trace.push('first:end');
    return 'first';
  });
  const second = queue.run(async () => {
    trace.push('second:start');
    trace.push('second:end');
    return 'second';
  });

  await Promise.resolve();
  assert.deepEqual(trace, ['first:start']);
  releaseFirst();
  assert.equal(await first, 'first');
  assert.equal(await second, 'second');
  assert.deepEqual(trace, ['first:start', 'first:end', 'second:start', 'second:end']);
});

test('serial task queue continues after a failed task', async () => {
  const queue = createSerialTaskQueue();
  await assert.rejects(queue.run(async () => { throw new Error('refresh failed'); }));
  assert.equal(await queue.run(async () => 'next refresh'), 'next refresh');
});

test('reset lets a new session start without waiting for the previous session tail', async () => {
  const queue = createSerialTaskQueue();
  let releaseOld;
  const oldGate = new Promise((resolve) => { releaseOld = resolve; });
  const old = queue.run(async () => { await oldGate; return 'old'; });
  queue.reset();
  assert.equal(await queue.run(async () => 'new'), 'new');
  releaseOld();
  assert.equal(await old, 'old');
});
