import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ts = createRequire(new URL('../mobile/package.json', import.meta.url))('typescript');
const source = readFileSync('mobile/app/index.tsx', 'utf8');
const ast = ts.createSourceFile('home.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let actualLoader = '';
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'loadTaskEditorDetails') actualLoader = node.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(actualLoader, 'test the actual Home record editor loader');

function harness() {
  const state = {
    title: '사용자가 입력 중인 새 제목',
    date: '2026-11-10', time: '09:00',
    ready: null, loading: null, status: '', tone: 'neutral',
    kind: null, original: null, conversionAllowed: false,
  };
  const scope = {
    session: { user: { id: 'owner' } }, client: {}, editBusy: false,
    editReadEpoch: { current: 0 },
    editDetailsCache: { current: new Map([['record-1', {
      title: '이전 서버 제목', dueDate: '2026-11-10', dueTime: '09:00',
    }]]) },
    editDirty: { current: { title: true, date: false, time: false, kind: false } },
    getFreshAccessToken: async () => 'synthetic-token',
    readWorklogDetails: async () => { throw new Error('offline: no fresh record'); },
    setEditLoading: v => { state.loading = v; },
    setEditReady: v => { state.ready = v; },
    setEditTitle: v => { state.title = v; },
    setEditDate: v => { state.date = v; },
    setEditTime: v => { state.time = v; },
    setEditStatus: v => { state.status = v; },
    setEditStatusTone: v => { state.tone = v; },
    setEditActionKind: v => { state.kind = v; },
    setEditOriginalActionKind: v => { state.original = v; },
    setEditActionConversionAllowed: v => { state.conversionAllowed = v; },
    messageOf: e => e instanceof Error ? e.message : 'read error',
  };
  const js = ts.transpileModule(actualLoader, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const load = new Function('scope', `with(scope) { ${js}; return loadTaskEditorDetails; }`)(scope);
  return { state, scope, load };
}

test('Home cannot save stale seeded fields after owner detail read fails; retry keeps user typing', async () => {
  const h = harness();
  await h.load('record-1', '목록 제목', '2026-11-10', '09:00');
  assert.equal(h.state.ready, false, 'stale cached data cannot enable Save after fetch failure');
  assert.equal(h.state.loading, false);
  assert.equal(h.state.title, '사용자가 입력 중인 새 제목', 'fallback must not overwrite active typing');
  assert.match(h.state.status, /offline/);
  assert.equal(h.state.tone, 'error');

  await h.load('record-1', h.state.title, h.state.date);
  assert.equal(h.state.ready, false);
  assert.equal(h.state.title, '사용자가 입력 중인 새 제목', 'retry keeps draft despite cached seed');
  assert.match(source, /editBusy \|\| editLoading \|\| !editReady\) return;/);
});

test('Home enables editing only after a successful fresh owner detail read', async () => {
  const h = harness();
  await h.load('record-1', '목록 제목', '2026-11-10', '09:00');
  h.scope.readWorklogDetails = async (token, id) => {
    assert.equal(token, 'synthetic-token');
    assert.equal(id, 'record-1');
    return { title: '서버 최신 제목', dueDate: '2026-11-12', dueTime: '15:00',
      actionKind: 'task', actionConversionAllowed: true };
  };
  await h.load('record-1', h.state.title, h.state.date);
  assert.equal(h.state.ready, true);
  assert.equal(h.state.loading, false);
  assert.equal(h.state.title, '사용자가 입력 중인 새 제목', 'typing still wins over late read');
  assert.equal(h.state.date, '2026-11-12', 'unmodified date gets canonical server value');
  assert.equal(h.state.time, '15:00');
  assert.equal(h.state.original, 'task');
  assert.equal(h.state.conversionAllowed, true);
  assert.equal(h.state.tone, 'neutral');
});

test('seeded Home editor visibly waits for fresh details before Save is enabled', async () => {
  const h = harness();
  let finish;
  h.scope.readWorklogDetails = () => new Promise(resolve => { finish = resolve; });
  const pending = h.load('record-1', '목록 제목', '2026-11-10', '09:00');
  assert.equal(h.state.loading, true, 'even a seeded editor must display the current fetch');
  assert.equal(h.state.ready, false, 'Save stays locked while the current read is pending');
  await Promise.resolve();
  finish({ title: '현재 서버 제목', dueDate: '2026-11-13', dueTime: '11:30',
    actionKind: 'task', actionConversionAllowed: false });
  await pending;
  assert.equal(h.state.loading, false);
  assert.equal(h.state.ready, true);
});
