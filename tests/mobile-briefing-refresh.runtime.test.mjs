import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, register } from 'node:module';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { createSerialTaskQueue } = await import('../mobile/src/platform/serial-task-queue.ts');
const { createQuickVoiceSaveAttempt } = await import('../mobile/src/features/voice/quick-voice-flow.ts');
const ts = createRequire(new URL('../mobile/package.json', import.meta.url))('typescript');
const home = ts.createSourceFile('home.tsx', readFileSync('mobile/app/index.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const card = ts.createSourceFile('card.tsx', readFileSync('mobile/src/features/voice/voice-recorder-card.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(ast, name) {
  let result = '';
  function visit(n) { if (ts.isFunctionDeclaration(n) && n.name?.text === name) result = n.getText(ast); ts.forEachChild(n, visit); }
  visit(ast); return result;
}
function compile(code, scope) {
  const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function('scope', `with(scope) { ${js} }`)(scope);
}
function harness() {
  const state = { briefing: { title: 'previous snapshot' }, error: '', busy: false, reads: 0 };
  const scope = {
    session: {}, client: {}, briefingRefreshEpoch: { current: 1 }, briefingRefreshQueue: { current: createSerialTaskQueue() },
    editDetailsCache: { current: new Map() }, androidTouchSmoke: false, initialReminderRecovery: { current: Promise.resolve() },
    freshHomeAccessToken: async () => 'synthetic',
    loadHomeBriefing: async () => { state.reads++; throw new Error('synthetic offline'); },
    setBriefing: value => { state.briefing = value; }, setBriefingBusy: value => { state.busy = value; },
    setBriefingError: value => { state.error = value; }, messageOf: (e, fallback) => e instanceof Error ? e.message : fallback,
    synchronizeBriefingScheduleReminders: async () => {}, console,
  };
  // Read the callback actually passed by Home, including shorthand properties.
  let callback;
  function visit(n) {
    if (ts.isJsxAttribute(n) && n.name.getText(home) === 'quickVoice' && n.initializer?.expression && ts.isObjectLiteralExpression(n.initializer.expression)) {
      const p = n.initializer.expression.properties.find(p => p.name?.getText(home) === 'refreshBriefing');
      if (p) callback = ts.isShorthandPropertyAssignment(p) ? p.name.getText(home) : p.initializer.getText(home);
    }
    ts.forEachChild(n, visit);
  }
  visit(home); assert.ok(callback);
  const code = `${declaration(home, 'refreshBriefing')}\n${declaration(home, 'refreshQuickVoiceBriefing')}`;
  const api = compile(`${code}\nreturn { refreshBriefing, quickRefresh: ${callback} };`, scope);
  return { state, scope, ...api };
}

test('actual Home callback tells Quick Voice that save succeeded but list refresh failed, without another write', async () => {
  const h = harness(); let writes = 0;
  const attempt = createQuickVoiceSaveAttempt({
    transcript: { text: '합성 업무', createdAt: '2026-11-08T01:00:00Z' },
    clientRequestId: 'synthetic-voice', recordedAt: '2026-11-08T01:00:00Z',
    saveWorklog: async () => { writes++; return { recordId: 'saved' }; }, refreshBriefing: h.quickRefresh,
  });
  const saved = await attempt.save();
  assert.equal(saved.saveResult.recordId, 'saved');
  assert.ok(saved.briefingRefreshError, 'Home must propagate list failure to the existing voice recovery UI');
  assert.equal(h.state.error, 'synthetic offline');
  assert.equal(h.state.briefing.title, 'previous snapshot');
  assert.equal(h.state.busy, false);
  await attempt.save(); assert.equal(writes, 1);
  await assert.rejects(h.quickRefresh());
  h.scope.loadHomeBriefing = async () => ({ title: 'fresh snapshot', schedules: {} });
  await h.quickRefresh();
  assert.equal(h.state.briefing.title, 'fresh snapshot'); assert.equal(h.state.error, '');
  assert.equal(writes, 1);
});

test('actual voice list-only retry stays in recovery on failure and succeeds only after a fresh read', async () => {
  const h = harness(); const phases = [];
  const scope = { quickVoice: { refreshBriefing: h.quickRefresh }, inFlight: { current: false },
    setQuickPhase: value => phases.push(value), setError() {}, messageOf: e => e.message };
  const retry = compile(`${declaration(card, 'retryBriefing')}\nreturn retryBriefing;`, scope);
  await retry(); assert.deepEqual(phases, ['refreshing', 'refresh_error']); assert.equal(scope.inFlight.current, false);
  h.scope.loadHomeBriefing = async () => ({ schedules: {} });
  await retry(); assert.deepEqual(phases.slice(-2), ['refreshing', 'saved']);
});

test('background and manual Home refresh display errors without rejecting event handlers', async () => {
  const h = harness();
  await h.refreshBriefing();
  assert.equal(h.state.error, 'synthetic offline'); assert.equal(h.state.busy, false);
});

test('expired session epochs cannot report an old snapshot as a successful voice refresh', async () => {
  const h = harness(); let release;
  h.scope.loadHomeBriefing = () => new Promise(resolve => { release = resolve; });
  const pending = h.quickRefresh();
  await new Promise(resolve => setImmediate(resolve));
  h.scope.briefingRefreshEpoch.current++;
  release({ title: 'stale private snapshot', schedules: {} });
  await assert.rejects(pending);
  assert.equal(h.state.briefing.title, 'previous snapshot');
});

test('native reminder cleanup failure after a fresh list is separate from list retrieval failure', async () => {
  const h = harness(); h.scope.console = { warn() {} };
  h.scope.loadHomeBriefing = async () => ({ title: 'fresh', schedules: {} });
  h.scope.synchronizeBriefingScheduleReminders = async () => { throw new Error('native unavailable'); };
  await h.quickRefresh(); assert.equal(h.state.briefing.title, 'fresh'); assert.equal(h.state.error, '');
});

test('completion and undo keep their confirmed server result when list retrieval fails; only reads are retried', async () => {
  const h = harness(); const mutations = []; const messages = [];
  const scope = {
    session: {}, client: {}, taskBusyId: null, taskStatusInFlight: { current: false }, recordMutationInFlight: { current: false }, undoTask: null, refreshBriefing: h.refreshBriefing,
    getFreshAccessToken: async () => 'synthetic', clearMessage() {},
    setTaskBusyId: value => { scope.taskBusyId = value; },
    setUndoTask: value => { scope.undoTask = value; },
    updateWorklogStatus: async (_token, id, status) => { mutations.push({ id, status }); },
    showMessage: (text, tone) => messages.push({ text, tone }), messageOf: e => e.message,
  };
  const api = compile(`${declaration(home, 'completeTaskInline')}\n${declaration(home, 'undoCompletedTask')}\nreturn { completeTaskInline, undoCompletedTask };`, scope);
  await api.completeTaskInline({ pageId: 'saved', title: '합성 업무', status: '대기' });
  assert.equal(scope.undoTask.status, '대기'); assert.equal(scope.taskBusyId, null);
  assert.equal(h.state.error, 'synthetic offline');
  await h.refreshBriefing(); assert.equal(mutations.length, 1);
  await api.undoCompletedTask();
  assert.deepEqual(mutations, [{ id: 'saved', status: '완료' }, { id: 'saved', status: '대기' }]);
  assert.equal(scope.undoTask, null); assert.equal(scope.taskBusyId, null);
  assert.equal(messages.at(-1).tone, 'info'); assert.match(messages.at(-1).text, /목록만 새로고침/); assert.equal(h.state.error, 'synthetic offline');
});


test('two rapid taps on the same task create only one completed-status write', async () => {
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const calls = [];
  const scope = {
    session: {}, client: {}, taskBusyId: null, taskStatusInFlight: { current: false }, recordMutationInFlight: { current: false }, undoTask: null,
    getFreshAccessToken: async () => 'fresh',
    updateWorklogStatus: async (_token, id, status) => { calls.push({ id, status }); await barrier; },
    setTaskBusyId() {}, setUndoTask(value) { scope.undoTask = value; }, clearMessage() {},
    refreshBriefing: async () => true, showMessage() {}, messageOf: e => e.message,
  };
  const complete = compile(`${declaration(home, 'completeTaskInline')}\nreturn completeTaskInline;`, scope);
  const task = { pageId: 'task-1', title: '합성 업무', status: '대기' };
  const first = complete(task);
  const second = complete(task); // before a React render updates taskBusyId
  await Promise.resolve();
  assert.deepEqual(calls, [{ id: 'task-1', status: '완료' }]);
  release();
  await Promise.all([first, second]);
  assert.equal(scope.taskStatusInFlight.current, false);
  assert.equal(scope.undoTask.status, '대기');
});

test('rapid Undo taps write one restoration and failed writes release the lock for retry', async () => {
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const calls = [];
  const target = { pageId: 'task-2', title: '합성 업무', status: '진행중', previousAttentionAt: null };
  const scope = {
    session: {}, client: {}, taskBusyId: null, taskStatusInFlight: { current: false }, recordMutationInFlight: { current: false }, undoTask: target,
    getFreshAccessToken: async () => 'fresh',
    updateWorklogStatus: async (_token, id, status) => { calls.push({ id, status }); await barrier; },
    setTaskBusyId() {}, setUndoTask(value) { scope.undoTask = value; }, clearMessage() {},
    refreshBriefing: async () => true, showMessage() {}, messageOf: e => e.message,
  };
  const undo = compile(`${declaration(home, 'undoCompletedTask')}\nreturn undoCompletedTask;`, scope);
  const first = undo(), second = undo();
  await Promise.resolve();
  assert.deepEqual(calls, [{ id: 'task-2', status: '진행중' }]);
  release();
  await Promise.all([first, second]);
  assert.equal(scope.undoTask, null);
  assert.equal(scope.taskStatusInFlight.current, false);

  let attempts = 0;
  scope.updateWorklogStatus = async () => { attempts++; if (attempts === 1) throw Error('offline'); };
  const complete = compile(`${declaration(home, 'completeTaskInline')}\nreturn completeTaskInline;`, scope);
  await complete({ pageId: 'task-3', title: '합성 업무', status: '대기' });
  assert.equal(scope.taskStatusInFlight.current, false);
  await complete({ pageId: 'task-3', title: '합성 업무', status: '대기' });
  assert.equal(attempts, 2);
  assert.equal(scope.taskStatusInFlight.current, false);
});

test('note acknowledge and Undo renew access token instead of reusing an expired session token', async () => {
  const calls = [];
  const scope = {
    session: { access_token: 'expired' }, client: {}, noteBusyId: null, undoNote: null,
    getFreshAccessToken: async () => 'fresh',
    updateBriefingNoteState: async (token, id, state) => { calls.push({ token, id, state }); },
    setNoteBusyId() {}, setUndoNote(value) { scope.undoNote = value; },
    removeVisibleNote() {}, refreshBriefing: async () => true,
    clearMessage() {}, showMessage() {}, messageOf: e => e.message,
  };
  const api = compile(`${declaration(home, 'acknowledgeNote')}\n${declaration(home, 'undoAcknowledgedNote')}\nreturn { acknowledgeNote, undoAcknowledgedNote };`, scope);
  await api.acknowledgeNote({ pageId: 'note-1', title: '합성 메모' });
  assert.equal(scope.undoNote.pageId, 'note-1');
  await api.undoAcknowledgedNote();
  assert.deepEqual(calls, [
    { token: 'fresh', id: 'note-1', state: 'acknowledged' },
    { token: 'fresh', id: 'note-1', state: 'active' },
  ]);
});
