import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ts = createRequire(new URL('../mobile/package.json', import.meta.url))('typescript');
const source = readFileSync('mobile/app/index.tsx', 'utf8');
const ast = ts.createSourceFile('home.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name) {
  let found = '';
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(found, 'missing real Home action ' + name);
  return found;
}
const names = ['postponeSelectedTask','remindSelectedTask','undoPostponedTask','undoTaskAttention'];
function compile(scope) {
  const code = names.map(declaration).join('\n');
  const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function('scope', 'with(scope) { ' + js + '; return { ' + names.join(',') + ' }; }')(scope);
}
function gate() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function harness() {
  const calls = [], messages = [];
  const scope = {
    session: { user: { id: 'owner' } }, client: {}, selectedTask: { task: { pageId: 'task-1', title: '계약서 확인' } },
    reminderBusyId: null, reminderMutationInFlight: { current: false }, undoPostpone: null, undoAttention: null,
    setReminderBusyId() {}, // Simulate two taps before React's state is updated
    clearMessage() {},
    getFreshAccessToken: async () => 'fresh-token',
    readWorklogDetails: async () => ({ dueTime: '14:00' }),
    postponeWorklog: async (_token, input) => { calls.push({ method: 'postpone', input }); return {}; },
    undoPostponeWorklog: async (_token, id) => { calls.push({ method: 'undoPostpone', id }); return {}; },
    setWorklogAttention: async (_token, id, when) => { calls.push({ method: 'attention', id, when }); return { nextAttentionAt: when, previousAttentionAt: null }; },
    undoWorklogAttention: async (_token, id, applied, previous) => { calls.push({ method: 'undoAttention', id, applied, previous }); return {}; },
    setUndoPostpone(v) { scope.undoPostpone = v; },
    setUndoAttention(v) { scope.undoAttention = v; },
    setSelectedTask(v) { scope.selectedTask = v; },
    setScreen() {},
    showMessage(message,tone) { messages.push({ message, tone }); },
    refreshBriefing: async () => true,
    messageOf(error) { return error.message; },
  };
  return { scope, calls, messages, ...compile(scope) };
}

test('rapid double postpones and a competing attention tap share one active mutation lock', async () => {
  const h = harness(), hold = gate();
  h.scope.postponeWorklog = async (_token,input) => { h.calls.push({method:'postpone',input}); await hold.promise; return {}; };
  const first = h.postponeSelectedTask('2030-01-03');
  await h.postponeSelectedTask('2030-01-03');
  await h.remindSelectedTask('2030-01-04');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.calls.filter(x => x.method === 'postpone').length, 1);
  assert.equal(h.calls.filter(x => x.method === 'attention').length, 0);
  assert.equal(h.scope.reminderMutationInFlight.current, true);
  hold.resolve(); await first;
  assert.equal(h.scope.reminderMutationInFlight.current, false);
  assert.equal(h.scope.undoPostpone.pageId, 'task-1');
  assert.equal(h.calls[0].input.dueTime, '14:00', 'original due time is retained');
});

test('rapid Undo of postpone cannot accidentally restore an older due date twice', async () => {
  const h = harness(), hold = gate();
  h.scope.undoPostpone = { pageId: 'task-1', title: '계약서 확인' };
  h.scope.undoPostponeWorklog = async (_token,id) => { h.calls.push({method:'undoPostpone',id}); await hold.promise; return {}; };
  const first = h.undoPostponedTask();
  await h.undoPostponedTask();
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(h.calls.map(x=>x.method), ['undoPostpone']);
  hold.resolve(); await first;
  assert.equal(h.scope.undoPostpone, null);
  assert.equal(h.scope.reminderMutationInFlight.current, false);
});

test('attention changes and their Undo ignore extra taps and can recover from errors', async () => {
  const h = harness(), hold = gate();
  h.scope.setWorklogAttention = async (_token,id,when) => {
    h.calls.push({ method: 'attention', id, when }); await hold.promise;
    return { nextAttentionAt: when, previousAttentionAt: '2029-12-01T09:00:00+09:00' };
  };
  const first = h.remindSelectedTask('2030-01-04');
  await h.remindSelectedTask('2030-01-04');
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(h.calls.map(x=>x.method), ['attention']);
  hold.resolve(); await first;
  assert.equal(h.scope.reminderMutationInFlight.current, false);
  assert.equal(h.scope.undoAttention.previousAttentionAt, '2029-12-01T09:00:00+09:00');

  const undoHold = gate();
  h.scope.undoWorklogAttention = async (_token,id,applied,previous) => {
    h.calls.push({method:'undoAttention',id,applied,previous}); await undoHold.promise; return {};
  };
  const undo = h.undoTaskAttention();
  await h.undoTaskAttention();
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(h.calls.map(x=>x.method), ['attention','undoAttention']);
  undoHold.resolve(); await undo;
  assert.equal(h.scope.undoAttention, null);
  assert.equal(h.scope.reminderMutationInFlight.current, false);

  h.scope.selectedTask = { task: { pageId:'task-1',title:'계약서 확인' } };
  h.scope.setWorklogAttention = async () => { throw Error('offline'); };
  await h.remindSelectedTask('2030-01-05');
  assert.equal(h.scope.reminderMutationInFlight.current, false, 'failed writes release the lock');
  assert.equal(h.messages.at(-1).tone, 'error');
  h.scope.setWorklogAttention = async (_token,id,when) => { h.calls.push({method:'attention',id,when}); return { nextAttentionAt:when }; };
  await h.remindSelectedTask('2030-01-05');
  assert.equal(h.scope.reminderMutationInFlight.current, false);
  assert.equal(h.calls.filter(x=>x.method === 'attention').length, 2);
});
