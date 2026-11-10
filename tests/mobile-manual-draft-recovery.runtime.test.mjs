import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { createManualWorkDraftStorage, manualDraftSignature } =
  await import('../mobile/src/features/work/manual-work-draft.ts');
const { createManualWorkSaveSession } =
  await import('../mobile/src/features/work/manual-work-save.ts');

function store() {
  const values = new Map();
  return {
    values,
    async getItem(key) { return values.get(key) ?? null; },
    async updateItem(key, update) {
      const next = update(values.get(key) ?? null);
      if (next === null) values.delete(key);
      else values.set(key, next);
      return next;
    },
    async removeItem(key) { values.delete(key); },
  };
}
const draft = () => ({ transcript: '거래처 서류 확인', dueDate: '2026-11-12', dueTime: '15:00' });

test('owner-scoped encrypted-store contract restores text/date/time without exposing another account', async () => {
  const local = store();
  const alice = createManualWorkDraftStorage(local, 'alice');
  const bob = createManualWorkDraftStorage(local, 'bob');
  const first = draft();
  await alice.saveDraft(first);
  await bob.saveDraft({ transcript: 'B 계정만', dueDate: '', dueTime: '' });
  const reloaded = createManualWorkDraftStorage(local, 'alice');
  assert.deepEqual((await reloaded.load()).draft, first);
  assert.equal((await reloaded.load()).attempt, null);
  assert.equal((await bob.load()).draft.transcript, 'B 계정만');
  await alice.clear();
  assert.equal(await reloaded.load(), null);
  assert.equal((await bob.load()).draft.transcript, 'B 계정만');
  assert.deepEqual(Object.keys(Object.fromEntries(local.values)).sort(),
    ['worklog.manual.draft.v1.bob']);
});

test('request ID checkpoint is stored before HTTP and a restarted app retries the SAME record', async () => {
  const local = store(), vault = createManualWorkDraftStorage(local, 'owner-a');
  const firstInput = draft();
  const backend = new Map(), requests = [];
  await vault.saveDraft(firstInput);
  const before = createManualWorkSaveSession();
  await assert.rejects(before.save(firstInput, async (text, options) => {
    const savedState = await vault.load();
    assert.equal(savedState.attempt.options.clientRequestId, options.clientRequestId);
    requests.push({ text, ...options });
    if (!backend.has(options.clientRequestId)) backend.set(options.clientRequestId, { recordId: 'one' });
    throw Error('response lost after commit');
  }, checkpoint => vault.prepareSave(firstInput, checkpoint)), /response lost/);
  const recovered = await vault.load();
  assert.equal(recovered.attempt.signature, manualDraftSignature(firstInput));
  const restarted = createManualWorkSaveSession();
  restarted.restore(recovered.attempt);
  const saved = await restarted.save(recovered.draft, async (text, options) => {
    requests.push({ text, ...options });
    return backend.get(options.clientRequestId);
  }, checkpoint => vault.prepareSave(recovered.draft, checkpoint));
  assert.equal(saved.recordId, 'one');
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(backend.size, 1);
  await vault.clear();
  assert.equal(await vault.load(), null);
});

test('changing the unsaved content invalidates an old request checkpoint', async () => {
  const local = store(), vault = createManualWorkDraftStorage(local, 'owner-a');
  const before = createManualWorkSaveSession();
  const original = draft();
  await assert.rejects(before.save(original, async () => { throw Error('offline'); },
    checkpoint => vault.prepareSave(original, checkpoint)), /offline/);
  const old = await vault.load();
  const edited = { ...original, transcript: original.transcript + ' 추가' };
  await vault.saveDraft(edited);
  assert.equal((await vault.load()).attempt, null);
  const next = createManualWorkSaveSession();
  next.restore((await vault.load()).attempt);
  await next.save(edited, async () => ({ ok: true }),
    checkpoint => vault.prepareSave(edited, checkpoint));
  const current = await vault.load();
  assert.notEqual(current.attempt.options.clientRequestId, old.attempt.options.clientRequestId);
});

test('malformed or mismatched saved drafts fail closed without replacing the original bytes', async () => {
  const local = store(), vault = createManualWorkDraftStorage(local, 'owner-a');
  local.values.set('worklog.manual.draft.v1.owner-a', '{corrupt-personal-draft');
  const original = local.values.get('worklog.manual.draft.v1.owner-a');
  await assert.rejects(vault.load(), /기존 파일을 보존/);
  let called = false;
  const session = createManualWorkSaveSession();
  await assert.rejects(session.save(draft(), async () => { called = true; return {}; },
    checkpoint => vault.prepareSave(draft(), checkpoint)), /기존 파일을 보존/);
  assert.equal(called, false, 'never write to server without a durable retry ID');
  assert.equal(local.values.get('worklog.manual.draft.v1.owner-a'), original);
  await assert.rejects(vault.saveDraft(draft()), /기존 파일을 보존/);
  assert.equal(local.values.get('worklog.manual.draft.v1.owner-a'), original);
});

test('bad dates, wrong owner scope and unverified request metadata are rejected', async () => {
  const local = store();
  assert.throws(() => createManualWorkDraftStorage(local, '../other-user'), /OWNER_INVALID/);
  const vault = createManualWorkDraftStorage(local, 'owner-a');
  await assert.rejects(vault.saveDraft({ ...draft(), dueDate: '2026-02-30' }), /CORRUPT/);
  await assert.rejects(vault.saveDraft({ ...draft(), dueDate: '', dueTime: '14:00' }), /CORRUPT/);
  await assert.rejects(vault.prepareSave(draft(), {
    signature: manualDraftSignature(draft()),
    transcript: draft().transcript,
    options: { clientRequestId: 'cross-account', recordedAt: new Date().toISOString(),
      dueDate: draft().dueDate, dueTime: draft().dueTime },
  }), /기존 파일을 보존/);
  assert.equal(await vault.load(), null);
});

test('Home runs encrypted recovery before enabling edit and prevents delayed writes from resurrecting a committed draft', () => {
  const home = readFileSync('mobile/app/index.tsx', 'utf8');
  assert.match(home, /createManualWorkDraftStorage\(secureSessionStorage, session\.user\.id\)/);
  assert.match(home, /manualSaveSession\.current\.restore\(saved\.attempt\)/);
  assert.match(home, /busy=\{busy \|\| !manualDraftLoaded\}/);
  assert.match(home, /capturedEpoch !== manualDraftEpoch\.current \|\| manualSaveInFlight\.current/);
  assert.match(home, /manualVault\.prepareSave\(\{\.\.\.manualInput,\.\.\.\(repeatRule/);
  assert.match(home, /await manualVault\?\.clear\(\)/);
});


test('반복 설정도 같은 소유자의 암호화 초안/요청과 함께 재시작 복구되고 잘못된 규칙은 보존 후 거부',async()=>{
 const local=store(),vault=createManualWorkDraftStorage(local,'repeat-owner');
 const input={...draft(),repeatRule:{kind:'weekly',anchor:'2026-11-12',interval:2,weekdays:[5],unit:'week'}};
 await vault.saveDraft(input);assert.deepEqual((await createManualWorkDraftStorage(local,'repeat-owner').load()).draft,input);
 const session=createManualWorkSaveSession();await assert.rejects(session.save(input,async()=>{throw Error('lost')},checkpoint=>vault.prepareSave(input,checkpoint)),/lost/);
 const stored=await vault.load();assert.deepEqual(stored.draft.repeatRule,input.repeatRule);assert.ok(stored.attempt.options.clientRequestId);
 const before=await local.getItem('worklog.manual.draft.v1.repeat-owner');
 await assert.rejects(vault.saveDraft({...input,repeatRule:{...input.repeatRule,interval:0}}));assert.equal(await local.getItem('worklog.manual.draft.v1.repeat-owner'),before);
});
