import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createUpdateSession, openUpdateStore } from '../mobile/src/features/startup/app-update-policy.ts';
const ts = createRequire(new URL('../mobile/package.json', import.meta.url))('typescript');
const source = readFileSync('mobile/src/features/startup/app-update-prompt.tsx', 'utf8');
const ast = ts.createSourceFile('prompt.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === 'AppUpdatePrompt').getText(ast).replace('export ', '');
const compiled = ts.transpileModule(`${declaration}\nreturn AppUpdatePrompt;`, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(check, openURL = async () => {}, timeout = 5000) {
  const states = []; let cursor = 0; let effect; let cleanup; let onState;
  const session = createUpdateSession(check, timeout);
  const scope = {
    React: { createElement(type, props, ...children) { return { type, props: { ...props, children } }; } },
    useState(value) { const i = cursor++; if (!(i in states)) states[i] = value; return [states[i], next => { states[i] = next; }]; },
    useEffect(fn) { effect = fn; },
    AppState: { currentState: 'active', addEventListener(_event, fn) { onState = fn; return { remove() { onState = null; } }; } },
    updateSession: session, openUpdateStore, Linking: { openURL }, styles: new Proxy({}, { get: (_o, key) => key }),
  };
  for (const type of ['Modal', 'View', 'Text', 'ScrollView', 'Pressable']) scope[type] = type;
  const Component = new Function('scope', `with(scope) { ${compiled} }`)(scope);
  function render() { cursor = 0; return Component(); }
  function all(node) { return !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(all) : [node, ...all(node.props.children)]; }
  return {
    session, render, mount() { render(); cleanup = effect(); }, unmount() { cleanup?.(); },
    state(value) { onState(value); },
    press(label) { const tree = render(); const nodes = all(tree); const button = nodes.find(n => n.type === 'Pressable' && JSON.stringify(n.props.children).includes(label)); assert.ok(button, label); button.props.onPress(); },
  };
}
test('actual prompt dismisses with Later or Android back, suppresses resumes, checks again in a fresh runtime', async () => {
  for (const close of ['later', 'back']) {
    let reads = 0; const h = harness(async () => { reads++; return true; });
    h.mount(); await tick(); assert.equal(h.render().props.visible, true);
    if (close === 'later') h.press('나중에'); else h.render().props.onRequestClose();
    assert.equal(h.render().props.visible, false);
    h.state('background'); h.state('active'); await tick();
    assert.equal(h.render().props.visible, false); assert.equal(reads, 1); h.unmount();
    const relaunch = harness(async () => true); relaunch.mount(); await tick(); assert.equal(relaunch.render().props.visible, true); relaunch.unmount();
  }
});
test('actual prompt stays silent for current/offline/timeout and hides while backgrounded', async () => {
  for (const check of [async () => false, async () => { throw Error('offline'); }, () => new Promise(() => {})]) {
    const h = harness(check, undefined, 5); h.mount(); await new Promise(r => setTimeout(r, 10)); assert.equal(h.render().props.visible, false); h.unmount();
  }
  const h = harness(async () => true); h.mount(); await tick(); h.state('background'); assert.equal(h.render().props.visible, false); h.state('active'); await tick(); assert.equal(h.render().props.visible, true); h.unmount();
});
test('actual store button retries through HTTPS, dismisses on success, and keeps Later after failure', async () => {
  const calls = []; const h = harness(async () => true, async url => { calls.push(url); if (url.startsWith('market:')) throw Error('missing handler'); });
  h.mount(); await tick(); h.press('업데이트하기'); await tick();
  assert.deepEqual(calls, ['market://details?id=com.cetin072.worklog', 'https://play.google.com/store/apps/details?id=com.cetin072.worklog']);
  assert.equal(h.render().props.visible, false); h.unmount();
  const failed = harness(async () => true, async () => { throw Error('cannot open'); });
  failed.mount(); await tick(); failed.press('업데이트하기'); await tick();
  assert.equal(failed.render().props.visible, true); assert.match(JSON.stringify(failed.render()), /Play 스토어를 열지 못했습니다/);
  failed.press('나중에'); assert.equal(failed.render().props.visible, false); failed.unmount();
});
