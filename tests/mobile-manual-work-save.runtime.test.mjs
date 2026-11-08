import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { createManualWorkSaveSession } = await import('../mobile/src/features/work/manual-work-save.ts');
const draft = () => ({ transcript: '서류 확인', dueDate: '2026-11-12', dueTime: '15:00' });

test('lost save response retries the exact payload and key, even after the input object changes', async () => {
  const session = createManualWorkSaveSession();
  const input = draft();
  const requests = [];
  const records = new Map();
  const persist = async (text, options) => {
    const request = { text, ...options };
    requests.push(request);
    if (!records.has(options.clientRequestId)) records.set(options.clientRequestId, { recordId: 'saved-record' });
    if (requests.length === 1) throw new Error('response lost after commit');
    return records.get(options.clientRequestId);
  };
  await assert.rejects(session.save(input, persist), /response lost/);
  input.transcript = 'unsubmitted edit';
  const result = await session.save(draft(), persist);
  assert.equal(result.recordId, 'saved-record');
  assert.deepEqual(requests[1], requests[0]);
  assert.equal(requests[0].dueDate, '2026-11-12');
  assert.equal(requests[0].dueTime, '15:00');
  assert.equal(requests[0].type, '회의·통화');
  assert.ok(Number.isFinite(Date.parse(requests[0].recordedAt)));
  assert.equal(records.size, 1);
});

test('double tap joins one write; post-save failure retries return the cached success', async () => {
  const session = createManualWorkSaveSession();
  let writes = 0;
  let resolve;
  const gate = new Promise(r => { resolve = r; });
  const persist = async () => { writes++; await gate; return { recordId: 'saved' }; };
  const a = session.save(draft(), persist);
  const b = session.save(draft(), persist);
  assert.equal(a, b);
  resolve();
  await a;
  assert.equal((await session.save(draft(), persist)).recordId, 'saved');
  assert.equal(writes, 1);
});

test('new input and an intentional new record after reset get distinct IDs; account sessions are isolated', async () => {
  const a = createManualWorkSaveSession();
  const b = createManualWorkSaveSession();
  const keys = [];
  const persist = async (_text, options) => { keys.push(options.clientRequestId); return {}; };
  await a.save(draft(), persist);
  await a.save({ ...draft(), dueTime: '16:00' }, persist);
  a.reset();
  await a.save(draft(), persist);
  await b.save(draft(), persist);
  assert.equal(new Set(keys).size, 4);
});

test('empty input never writes and a synchronous transport error remains retryable', async () => {
  const session = createManualWorkSaveSession();
  let writes = 0;
  await assert.rejects(session.save({ ...draft(), transcript: ' ' }, async () => { writes++; }));
  assert.equal(writes, 0);
  let id;
  await assert.rejects(session.save(draft(), (_text, options) => { id = options.clientRequestId; throw new Error('offline'); }), /offline/);
  await session.save(draft(), async (_text, options) => assert.equal(options.clientRequestId, id));
});
