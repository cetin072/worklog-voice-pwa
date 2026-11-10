import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, register } from 'node:module';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { createManualWorkSaveSession } = await import('../mobile/src/features/work/manual-work-save.ts');
const ts = createRequire(new URL('../mobile/package.json', import.meta.url))('typescript');
const source = readFileSync('mobile/app/index.tsx', 'utf8');
const ast = ts.createSourceFile('home.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function fn(name, scope) {
  let node;
  function visit(n) { if (ts.isFunctionDeclaration(n) && n.name?.text === name) node = n; ts.forEachChild(n, visit); }
  visit(ast);
  assert.ok(node);
  const js = ts.transpileModule(node.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function('scope', `with(scope) { ${js}; return ${name}; }`)(scope);
}
const NETWORK_CONNECTION_MESSAGE = '서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요.';
const messageOf = fn('messageOf', { NETWORK_CONNECTION_MESSAGE });
test('Android DNS and fetch failures become actionable Korean, without exposing technical host dumps', () => {
  for (const raw of ['fetch failed: java.net.UnknownHostException: Unable to resolve host "synthetic.invalid"', 'Network request failed', 'Failed to fetch', 'getaddrinfo ENOTFOUND synthetic.invalid']) {
    assert.equal(messageOf(new Error(raw), 'fallback'), NETWORK_CONNECTION_MESSAGE);
  }
  assert.equal(messageOf(new Error('로그인이 만료되었습니다.'), 'fallback'), '로그인이 만료되었습니다.');
  assert.equal(messageOf(null, 'fallback'), 'fallback');
});
test('failed real direct-save handler preserves input and does not retry mutations automatically', async () => {
  let attempts = 0, cleared = 0, refreshed = 0, displayed, busy = false;
  const scope = { repeatRule:null, session: { access_token: 'expired-token' }, client: {}, getFreshAccessToken: async () => 'synthetic', manualInput: { transcript: '합성 입력', dueDate: '', dueTime: '' }, busy: false,
    manualSaveSession: { current: createManualWorkSaveSession() }, manualSaveInFlight: { current: false },
    manualScheduleText: () => '', reminderSessionEpoch: { capture: () => () => true },
    saveWorklog: async () => { attempts++; throw new Error('Network request failed'); },
    setBusy: value => { busy = value; }, clearMessage: () => {}, messageOf,
    showMessage: value => { displayed = value; }, setManualInput: () => { cleared++; },
    refreshBriefing: async () => { refreshed++; } };
  scope.run = fn('run', scope);
  await fn('persistDraft', scope)();
  assert.equal(attempts, 1); assert.equal(cleared, 0); assert.equal(refreshed, 0);
  assert.equal(busy, false); assert.equal(displayed, NETWORK_CONNECTION_MESSAGE);
  assert.equal(scope.manualInput.transcript, '합성 입력');
});
