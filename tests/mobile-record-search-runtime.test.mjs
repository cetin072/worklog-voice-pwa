import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ts = createRequire(new URL('../mobile/package.json', import.meta.url))('typescript');
const source = readFileSync('mobile/src/features/search/work-record-search.tsx', 'utf8');
const ast = ts.createSourceFile('search.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name) {
  let found = '';
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(found, 'missing actual search function: ' + name);
  return found;
}
function compile(names, scope) {
  const code = names.map(declaration).join('\n');
  const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function('scope', 'with(scope) { ' + js + '; return { ' + names.join(',') + ' }; }')(scope);
}
function makeSearch() {
  const state = { items: [], messages: [], nextOffset: 0, hasMore: false, busy: false };
  const pending = [];
  const scope = {
    query: '계약', statuses: [], nextOffset: 0, busy: false,
    searchEpoch: { current: 0 }, searchInFlightKey: { current: null }, client: {},
    setBusy(v) { state.busy = v; }, setMessage(v) { state.messages.push(v); },
    setQuery(v) { scope.query = v; },
    setItems(updater) { state.items = typeof updater === 'function' ? updater(state.items) : updater; },
    setNextOffset(v) { state.nextOffset = v; scope.nextOffset = v; },
    setHasMore(v) { state.hasMore = v; },
    setStatuses(update) { scope.statuses = update(scope.statuses); },
    searchMyWorkRecords(_client, query, offset, statuses) {
      return new Promise((resolve, reject) => pending.push({ query, offset, statuses, resolve, reject }));
    },
  };
  return { state, pending, scope, api: compile(['search','changeQuery','toggleStatus'], scope) };
}

test('typing a new query invalidates an in-flight old response and preserves the current result list', async () => {
  const h = makeSearch();
  const old = h.api.search(true);
  assert.equal(h.pending[0].query, '계약');
  h.api.changeQuery('회신');
  assert.equal(h.state.items.length, 0);
  assert.equal(h.state.busy, false);
  const fresh = h.api.search(true);
  assert.equal(h.pending[1].query, '회신');
  h.pending[1].resolve({ items: [{ workRecordId: 'B', title: '회신 기록' }], nextOffset: 1, hasMore: false });
  await fresh;
  h.pending[0].resolve({ items: [{ workRecordId: 'A', title: '계약 기록' }], nextOffset: 1, hasMore: false });
  await old;
  assert.deepEqual(h.state.items.map(x => x.workRecordId), ['B']);
  assert.equal(h.state.busy, false);
});

test('status change invalidates old search and repeated button taps make only one identical RPC', async () => {
  const h = makeSearch();
  const old = h.api.search(true);
  h.api.toggleStatus('completed');
  const current = h.api.search(true);
  await h.api.search(true);
  assert.equal(h.pending.length, 2);
  assert.deepEqual(h.pending[1].statuses, ['completed']);
  h.pending[0].resolve({ items: [{ workRecordId: 'A' }], nextOffset: 1, hasMore: false });
  await old;
  h.pending[1].resolve({ items: [{ workRecordId: 'B' }], nextOffset: 1, hasMore: false });
  await current;
  assert.deepEqual(h.state.items.map(x => x.workRecordId), ['B']);
});

function makeEditor() {
  const state = { title: '사용자 제목', date: '', time: '', ready: false, loading: false, status: '' };
  const pending = [];
  const scope = {
    client: {}, editBusy: false, editLoading: false, editId: 'A',
    editReadEpoch: { current: 0 }, editDirty: { current: { title: true, date: false, time: false, kind: false } },
    getFreshAccessToken: async () => 'fresh-token',
    readWorklogDetails(token, id) { return new Promise(resolve => pending.push({ token, id, resolve })); },
    setEditLoading(v) { state.loading = v; }, setEditReady(v) { state.ready = v; },
    setEditTitle(v) { state.title = v; }, setEditDate(v) { state.date = v; },
    setEditTime(v) { state.time = v; }, setEditStatus(v) { state.status = v; },
    setEditStatusTone() {}, setEditActionKind() {}, setEditOriginalActionKind() {},
    setEditActionConversionAllowed() {}, setEditId() {},
  };
  return { scope, state, pending, api: compile(['loadEditorDetails', 'cancelEditor'], scope) };
}

test('closing search editor invalidates a late detail reply and keeps an in-progress title', async () => {
  const h = makeEditor();
  const opening = h.api.loadEditorDetails('A', '목록 제목');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.pending.length, 1);
  h.api.cancelEditor();
  assert.equal(h.state.ready, false);
  h.pending[0].resolve({ title: '지연된 비공개 제목', dueDate: '2030-01-03', dueTime: '12:00' });
  await opening;
  assert.equal(h.state.title, '', 'closed sheet must stay cleared despite late response');
  assert.equal(h.state.loading, false);
});

test('owner-scoped fresh editor read does not overwrite title already typed by user', async () => {
  const h = makeEditor();
  const reading = h.api.loadEditorDetails('A', '목록 제목');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.pending[0].token, 'fresh-token');
  h.pending[0].resolve({ title: '서버 제목', dueDate: '2030-01-03', dueTime: '12:00', actionKind: 'task' });
  await reading;
  assert.equal(h.state.title, '사용자 제목');
  assert.equal(h.state.date, '2030-01-03');
  assert.equal(h.state.ready, true);
});
