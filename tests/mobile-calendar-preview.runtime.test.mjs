import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(new URL('../mobile/package.json', import.meta.url))('typescript');
test('actual QA preview opens and closes; production never exposes unfinished Calendar UI', (t) => {
  const previous = process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT;
  t.after(() => { if (previous === undefined) delete process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT; else process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT = previous; });
  process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT = 'qa';
  let state = false;
  const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), useState: () => [state, next => { state = next; }] };
  const native = Object.fromEntries(['Modal','Pressable','ScrollView','Text','View'].map(key => [key,key]));
  native.StyleSheet = { create: value => value };
  const compiled = ts.transpileModule(readFileSync('mobile/src/features/calendar/calendar-export-preview.tsx','utf8'), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function('require','exports',compiled)(name => name === 'react' ? React : name === 'react-native' ? native : { CALENDAR_APPROVAL_MESSAGE: '승인 대기 · 아직 등록하지 않았습니다' },exports);
  const render = () => exports.CalendarExportPreview({ title:'긴 제목 '.repeat(30), startsAt:'2026-10-28T01:00:00Z' });
  const all = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(all) : [node,...all(node.props.children)];
  const buttons = () => all(render()).filter(n => n.type === 'Pressable');
  buttons()[0].props.onPress();
  assert.equal(all(render()).find(n=>n.type==='Modal').props.visible,true);
  const tree = JSON.stringify(render()); assert.match(tree,/승인 대기/); assert.match(tree,/Asia\/Seoul/); assert.match(tree,/10:00/);
  assert.ok(all(render()).some(n=>n.type==='ScrollView'));
  assert.ok(all(render()).filter(n=>n.type==='Text').every(n=>n.props.numberOfLines===undefined));
  assert.equal(buttons()[0].props.style.minHeight,48);
  buttons()[1].props.onPress(); assert.equal(state,false);
  buttons()[0].props.onPress(); all(render()).find(n=>n.type==='Modal').props.onRequestClose(); assert.equal(state,false);
  for (const variant of ['production', undefined]) {
    if (variant === undefined) delete process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT;
    else process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT = variant;
    assert.equal(render(), null);
  }
});
