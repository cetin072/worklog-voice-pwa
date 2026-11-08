import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ts = createRequire(new URL('../mobile/package.json', import.meta.url))('typescript');
const sheet = ts.createSourceFile('sheet.tsx', readFileSync('mobile/src/features/schedule/worklog-reminder-sheet.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const settings = readFileSync('mobile/src/features/settings/reminder-settings.tsx', 'utf8');
function declaration(name) {
  let result;
  function walk(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node.getText(sheet);
    ts.forEachChild(node, walk);
  }
  walk(sheet);
  assert.ok(result, 'missing ' + name);
  return result;
}
function compile(code, scope) {
  const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function('scope', 'with(scope) { ' + js + ' }')(scope);
}

test('past manual offset rejects before any read/write and preserves prior verified reminder evidence', async () => {
  const messages = [];
  let cleared = 0, reads = 0, busy = 0;
  const scope = {
    gate: { current: false }, ready: true, schedule: { id: 'schedule', status: 'confirmed', startsAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString() },
    date: '', time: '', setMessage: value => messages.push(value),
    reminderFailureMessage: error => error.message === 'TIME_INVALID' ? '알림을 예약하지 않았습니다. 미래 시각을 선택해주세요.' : 'unknown',
    setEvidence: () => cleared++, setBusy: () => busy++,
    findWorklogReminder: async () => { reads++; throw Error('unexpected backend read'); },
  };
  const reserve = compile(declaration('reserve') + '\nreturn reserve;', scope);
  await reserve(1440);
  assert.equal(scope.gate.current, false);
  assert.equal(reads, 0);
  assert.equal(cleared, 0);
  assert.equal(busy, 0);
  assert.match(messages.at(-1), /미래 시각/);
});

test('settings distinguishes missing OS reservations from cleanup and handles status inspection failures', () => {
  assert.match(settings, /unverified > 0/);
  assert.match(settings, /reminderError \? '알림 예약 상태를 확인하지 못했습니다'/);
  assert.match(settings, /cleanupPending > 0/);
  assert.match(settings, /permission === 'allowed' && pending > 0/);
  assert.match(settings, /catch \{\s*setPermission\('error'\);\s*setPermissionDetail\('알림 권한 요청을 마치지 못했습니다/);
});
