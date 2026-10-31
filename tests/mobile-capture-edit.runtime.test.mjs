import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ts = createRequire(new URL('../mobile/package.json', import.meta.url))('typescript');
const source = readFileSync('mobile/app/capture.tsx', 'utf8');
const ast = ts.createSourceFile('capture.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = [], handlers = {};
function walk(node) {
  if (ts.isFunctionDeclaration(node) && ['openEditor', 'saveEdit', 'registerAgain'].includes(node.name?.text)) functions.push(node.getText(ast));
  if (ts.isJsxAttribute(node) && ['onTitle', 'onDate', 'onTime', 'onCancel'].includes(node.name.getText(ast))) handlers[node.name.getText(ast)] = node.initializer.expression.getText(ast);
  ts.forEachChild(node, walk);
}
walk(ast);
const code = ts.transpileModule(`${functions.join('\n')}\nreturn { openEditor, saveEdit, registerAgain, ${Object.entries(handlers).map(([name, body]) => `${name}: ${body}`).join(',')} };`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
const details = { title: '저장된 회의', dueDate: '2030-11-03', dueTime: '15:00' };
function harness(seed = details) {
  const pending = [], state = {}, writes = [];
  let save;
  const scope = { owner:'alice', client: {}, id: 'record-a', busy: false, editReady: false, epoch: { current: 0 }, editDirty: { current: {} },
    visible: { hash: 'a', owner: 'alice', saved: { pageId: 'record-a' }, details: seed },
    getFreshAccessToken: async () => 'synthetic',
    restartCapture: async(_client,entry)=>{writes.push(entry);return {...entry,undone:false,requestId:'new-request'};},
    processCapture: async entry=>({...entry,saved:{pageId:'new-record'}}),
    readWorklogDetails: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    editCapture: (_client, _entry, input) => new Promise((resolve,reject) => { save = { input, resolve, reject }; }),
    captureInbox: { put: async entry => writes.push(entry) },
  };
  for (const setter of new Set(code.match(/set[A-Z][A-Za-z]+/g))) scope[setter] = value => {
    state[setter] = value;
    const key = setter.slice(3); scope[key[0].toLowerCase() + key.slice(1)] = value;
  };
  const api = new Function('scope', `with(scope) { ${code} }`)(scope);
  return { api, scope, state, pending, writes, save: () => save };
}

test('first capture edit opens from saved details before a slow read and preserves typed fields', async () => {
  const h = harness(), read = h.api.openEditor();
  assert.equal(h.state.setEditing, true); assert.equal(h.state.setEditLoading, false); assert.equal(h.state.setEditReady, true);
  assert.equal(h.state.setTitle, details.title); assert.equal(h.state.setDate, details.dueDate); assert.equal(h.state.setTime, details.dueTime);
  h.api.onTitle('내 수정'); h.api.onDate('2031-01-01'); h.api.onTime('16:30');
  await tick(); h.pending[0].resolve({ title: '늦은 응답', dueDate: '2032-01-01', dueTime: '09:00' }); await read;
  assert.equal(h.state.setTitle, '내 수정'); assert.equal(h.state.setDate, '2031-01-01'); assert.equal(h.state.setTime, '16:30');
});

test('only missing details block editing; a known absent time stays editable when refresh is offline', async () => {
  const h = harness(null), read = h.api.openEditor();
  assert.equal(h.state.setEditLoading, true); assert.equal(h.state.setEditReady, false);
  await tick(); h.pending[0].resolve(details); await read; assert.equal(h.state.setEditReady, true);
  const offline = harness({ ...details, dueTime: '' }), refresh = offline.api.openEditor();
  assert.equal(offline.state.setEditLoading, false); assert.equal(offline.state.setEditReady, true); assert.equal(offline.state.setTime, '');
  await tick(); offline.pending[0].reject(Error('offline')); await refresh;
  assert.equal(offline.state.setEditReady, true); assert.equal(offline.state.setTitle, details.title);
});

test('rapid record changes and cancel reject stale detail responses', async () => {
  const h = harness(), a = h.api.openEditor(); await tick();
  h.scope.id = 'record-b'; h.scope.visible = { ...h.scope.visible, hash: 'b', details: { ...details, title: '다른 일정' } };
  const b = h.api.openEditor(); await tick();
  h.pending[0].resolve({ ...details, title: '이전 일정' }); await a; assert.equal(h.state.setTitle, '다른 일정');
  h.api.onCancel(); h.pending[1].resolve({ ...details, title: '닫은 뒤 응답' }); await b;
  assert.equal(h.state.setEditing, false); assert.equal(h.state.setTitle, '다른 일정');
});

test('saving keeps its loading state and invalidates an older background read', async () => {
  const h = harness(), read = h.api.openEditor(); await tick(); h.api.onTime('17:30');
  const saving = h.api.saveEdit(); assert.equal(h.state.setBusy, true); assert.equal(h.save().input.dueTime, '17:30');
  h.pending[0].resolve({ ...details, title: '저장 중 늦은 응답' }); await read;
  assert.equal(h.state.setTitle, details.title); assert.equal(h.state.setTime, '17:30');
  h.save().resolve({entry:{...h.scope.visible,details:{...details,dueTime:'17:30'},saved:{scheduleCreated:true,scheduleId:'canonical-schedule'}}}); await saving;
  assert.equal(h.state.setEntry.details.dueTime, '17:30'); assert.equal(h.state.setBusy, false); assert.equal(h.state.setEditing, false);
  assert.equal(h.state.setEntry.saved.scheduleCreated,true);assert.equal(h.state.setEntry.saved.scheduleId,'canonical-schedule');
});


test('alarm warning after a committed edit closes the editor and shows the saved receipt',async()=>{
 const h=harness();void h.api.openEditor();h.api.onDate('2030-11-04');const saving=h.api.saveEdit();
 const entry={...h.scope.visible,details:{...details,dueDate:'2030-11-04'},reminderWarning:'수정은 저장됐지만 알림 예약은 확인이 필요합니다.'};
 h.save().resolve({entry});await saving;
 assert.equal(h.state.setEditing,false);assert.equal(h.state.setEntry,entry);assert.equal(h.state.setEditError,'');
});
test('server edit error retains user input and editor, and displays the actual safe API reason',async()=>{
 const h=harness();void h.api.openEditor();h.api.onTitle('유지할 제목');const saving=h.api.saveEdit();
 h.save().reject(Error('개인 업무공간을 찾지 못했습니다.'));await saving;
 assert.equal(h.state.setEditing,true);assert.equal(h.state.setTitle,'유지할 제목');assert.equal(h.state.setEntry,undefined);
 assert.equal(h.state.setEditError,'개인 업무공간을 찾지 못했습니다.');assert.equal(h.state.setBusy,false);
});


test('explicit cancelled-screen registration invokes one restart and shows the new receipt',async()=>{
 const h=harness();h.scope.visible.undone=true;
 await Promise.all([h.api.registerAgain(),h.api.registerAgain()]);
 assert.equal(h.writes.length,1);assert.equal(h.state.setEntry.saved.pageId,'new-record');assert.equal(h.state.setEntry.undone,false);assert.equal(h.state.setBusy,false);
});
