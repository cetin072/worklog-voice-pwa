import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ts = createRequire(new URL('../mobile/package.json', import.meta.url))('typescript');
const card = ts.createSourceFile('voice-recorder-card.tsx', readFileSync('mobile/src/features/voice/voice-recorder-card.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const home = ts.createSourceFile('home.tsx', readFileSync('mobile/app/index.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function declaration(ast, name) {
  let found;
  function walk(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(ast);
    ts.forEachChild(node, walk);
  }
  walk(ast);
  assert.ok(found, 'missing function ' + name);
  return found;
}

function callback(ast, name) {
  let found;
  function walk(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === name
      && node.initializer && ts.isJsxExpression(node.initializer)) found = node.initializer.expression.getText(ast);
    ts.forEachChild(node, walk);
  }
  walk(ast);
  assert.ok(found, 'missing JSX callback ' + name);
  return found;
}

function compile(code, scope) {
  const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function('scope', 'with(scope) { ' + js + ' }')(scope);
}

test('fatal speech fallback passes recognized words into the existing direct-input action, not an API write', async () => {
  let forwarded;
  let writes = 0;
  const navigationGuard = { current: true };
  const scope = {
    onOpenWorklogInput: text => { forwarded = text; },
    inFlight: { current: false }, quickPhase: 'transcript_error', quickAudio: null,
    speechPreview: '내일 오전 10시 서류 확인',
    clearQuickVoiceDraft: async () => {},
    clientRequestId: { current: 'synthetic-id' }, saveAttempt: { current: {} },
    speechSession: { current: null }, recordingStartedAt: { current: 4 }, navigationGuard,
    applyQuickPhase: phase => { scope.phase = phase; },
  };
  for (const name of ['setRecordingElapsedMs','setError','setSpeechPreview','setQuickAudio',
    'setQuickTranscript','setQuickSave','setEditableTranscript','setFlowTimings']) scope[name] = () => {};
  scope.saveWorklog = () => { writes++; };
  const action = compile(declaration(card, 'openDirectInputFallback') + '\nreturn openDirectInputFallback;', scope);
  action();
  assert.equal(forwarded, '내일 오전 10시 서류 확인');
  assert.equal(navigationGuard.current, false);
  assert.equal(scope.phase, 'idle');
  assert.equal(writes, 0);
  assert.equal(scope.clientRequestId.current, null);
});

test('home pre-fills only an empty direct draft, keeping an existing unfinished draft intact', () => {
  const state = { manual: { transcript: '', dueDate: '2026-11-12', dueTime: '10:00' }, screen: null };
  const scope = {
    setManualInput: updater => { state.manual = updater(state.manual); },
    setScreen: next => { state.screen = next; },
  };
  const open = compile('const fallback = ' + callback(home, 'onOpenWorklogInput') + ';\nreturn fallback;', scope);
  open('  음성 인식 일부  ');
  assert.equal(state.manual.transcript, '음성 인식 일부');
  assert.equal(state.manual.dueDate, '2026-11-12');
  assert.equal(state.screen, 'input');

  state.manual = { transcript: '기존 미완료 입력', dueDate: '', dueTime: '' };
  open('추가 음성 일부');
  assert.equal(state.manual.transcript, '기존 미완료 입력');
  assert.equal(state.screen, 'input');
});
