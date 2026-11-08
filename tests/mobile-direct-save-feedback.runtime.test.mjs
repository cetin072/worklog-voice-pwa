import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { homeHarness, nodes, words } from './helpers/mobile-home-harness.mjs';

const source = readFileSync('mobile/app/index.tsx', 'utf8');
const require = createRequire(new URL('../mobile/package.json', import.meta.url));
const ts = require('typescript');
const ast = ts.createSourceFile('home.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

let matcherExpression;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'matchingDirectReminder') {
    assert.equal(matcherExpression, undefined, 'only one owner for direct-save reminder grouping');
    matcherExpression = node.initializer.getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(matcherExpression, 'direct-save UI must group reminder with same saved record identity');
const matchingReminder = new Function('lastDirectSave', 'savedReminder', 'return (' + matcherExpression + ');');

function fakeHome(result, matching, overrides = {}) {
  const briefing = {
    today: '2026-11-08',
    scheduleEnabled: false,
    structure: { today: [], overdue: [], upcoming: [], undated: [] },
    schedules: { today: [], upcoming: [] },
  };
  const calls = { target: [], clearReminder: [], closeResult: [] };
  const ctx = {
    briefing, structure: briefing.structure, overview: { empty: true },
    lastDirectSave: result,
    matchingDirectReminder: matching,
    formatSavedDue: () => '11. 12. 오후 3:00',
    setReminderTarget(v) { calls.target.push(v); },
    setSavedReminder(v) { calls.clearReminder.push(v); },
    setLastDirectSave(v) { calls.closeResult.push(v); },
    ...overrides,
  };
  return { home: homeHarness(ctx), calls };
}

const record = {
  recordId: '11111111-1111-4111-8111-111111111111',
  transcript: '검수용 일정 - 서류 확인',
  scheduleWarning: '',
  scheduleCreated: true,
  scheduleDetected: true,
  scheduleId: '22222222-2222-4222-8222-222222222222',
  dueStart: '2026-11-12T15:00:00+09:00',
};
const notice = {
  target: { recordId: record.recordId, scheduleId: record.scheduleId, title: record.transcript },
  message: '기록 저장 · 일정 생성 · 기기 알림 예약 미확인. 알림 설정에서 다시 확인해주세요.',
};

test('same saved record groups schedule result and device-reminder warning; other records never get hidden', () => {
  assert.equal(matchingReminder(record, notice), notice);
  assert.equal(matchingReminder(record, { ...notice, target: { recordId: 'another' } }), null);
  assert.equal(matchingReminder(null, notice), null);
  assert.equal(matchingReminder({ ...record, recordId: '' }, notice), null);
  assert.equal(matchingReminder(record, null), null);
  assert.match(source, /savedReminder && !\(screen === 'home' && matchingDirectReminder\)/);
  assert.match(source, /recordId: saved\.dataCoreWorkRecordId \|\| saved\.pageId \|\| ''/);
});

test('direct-save result has one inline reminder action with full saved outcome and preserved permissions', () => {
  const { home, calls } = fakeHome(record, notice);
  const tree = home.render();
  const text = words(tree);
  assert.match(text, /검수용 일정 - 서류 확인/);
  assert.match(text, /일정 생성 완료/);
  assert.match(text, /기기 알림 예약 미확인/);
  const buttons = nodes(tree).filter(n => n.props?.accessibilityLabel === '방금 저장한 기록 알림 확인');
  assert.equal(buttons.length, 1);
  buttons[0].props.onPress();
  assert.deepEqual(calls.target, [notice.target]);
  const close = nodes(tree).find(n => n.props?.accessibilityLabel === '직접 입력 저장 결과 닫기');
  assert.ok(close);
  close.props.onPress();
  assert.deepEqual(calls.clearReminder, [null], 'closing direct-save result also dismisses matched old reminder');
  assert.deepEqual(calls.closeResult, [null]);
});

test('record-id mismatch does not merge Quick Voice or edited-record reminder into stale direct-save result', () => {
  const other = { ...notice, target: { recordId: 'quick-voice-record', title: '다른 기록' } };
  const { home, calls } = fakeHome(record, matchingReminder(record, other));
  const tree = home.render();
  assert.equal(nodes(tree).filter(n => n.props?.accessibilityLabel === '방금 저장한 기록 알림 확인').length, 0);
  const close = nodes(tree).find(n => n.props?.accessibilityLabel === '직접 입력 저장 결과 닫기');
  close.props.onPress();
  assert.deepEqual(calls.clearReminder, [], 'do not clear a reminder from another saved record');
  assert.deepEqual(calls.closeResult, [null]);
});

test('pending or unconfirmed schedule does not become a fabricated reservation success', () => {
  const failed = {
    ...record,
    scheduleWarning: '업무만 저장되었습니다. 지정한 일정 저장을 확인하지 못했습니다.',
    scheduleCreated: false, scheduleId: '', dueStart: '',
  };
  const { home } = fakeHome(failed, { ...notice, target: { ...notice.target, recordId: record.recordId } });
  const text = words(home.render());
  assert.match(text, /업무만 저장되었습니다/);
  assert.doesNotMatch(text, /일정 생성 완료/);
  assert.match(text, /기기 알림 예약 미확인/);
});
