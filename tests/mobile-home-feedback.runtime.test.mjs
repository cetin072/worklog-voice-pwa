import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, register } from 'node:module';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { reminderLabel, reminderPresentation, reminderOffsetReserved } = await import('../mobile/src/features/home/reminder-label.ts');
const ts = createRequire(new URL('../mobile/package.json', import.meta.url))('typescript');
const source = readFileSync('mobile/app/index.tsx', 'utf8');
const ast = ts.createSourceFile('home.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function compile(code, scope) {
 const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
 return new Function('scope', `with(scope) { ${js} }`)(scope);
}
test('a hanging reminder recovery does not hold the first home fetch; cleanup rejects late UI updates', async () => {
 let callback;
 function walk(n) { if (ts.isCallExpression(n) && n.expression.getText(ast) === 'useEffect' && n.arguments[0]?.getText(ast).includes('recoverSavedScheduleReminders(client)')) callback = n.arguments[0].getText(ast); ts.forEachChild(n, walk); }
 walk(ast); assert.ok(callback);
 let release, refreshes = 0, clockUpdates = 0, foreground;
 // auth subscription is part of the production effect.
 const scopeClient = { auth: { onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; } } };
 const effect = compile(`return (${callback});`, {
   session: { access_token: 'synthetic' }, client: scopeClient, androidTouchSmoke: false, initialReminderRecovery: { current: Promise.resolve() },
   recoverSavedScheduleReminders: () => new Promise(resolve => { release = resolve; }),
   refreshBriefing: async () => { refreshes++; }, setBriefingNow: () => clockUpdates++,
   reminderSessionEpoch: { invalidate() {} }, reminderSyncEpoch: { invalidate() {} },
   AppState: { addEventListener(_name, fn) { foreground = fn; return { remove() {} }; } }, console, Date,
 });
 const cleanup = effect(); assert.equal(refreshes, 1);
 foreground('background'); assert.equal(refreshes, 1);
 cleanup(); release(); await new Promise(resolve => setImmediate(resolve)); assert.equal(clockUpdates, 0);
});
test('reserved, unset and unverified reminders differ in words and color, including each offset', () => {
 const stored = [{ identifier: 'native', offsetMinutes: 30, triggerAt: '2030-01-01T10:00:00Z', title: 'Synthetic' }];
 const scheduled = [{ identifier: 'native', content: { body: 'Synthetic', data: { target: 'schedule', scheduleId: 's', offsetMinutes: 30, triggerAt: stored[0].triggerAt } } }];
 const e = { permission: 'granted', stored, scheduled };
 const label = reminderLabel('s', e, Date.parse('2029-01-01'), '2030-01-01T10:30:00Z');
 assert.equal(reminderPresentation(label).title, '알림 예약됨');
 assert.equal(reminderOffsetReserved('s', e, 30, '2030-01-01T10:30:00Z', Date.parse('2029-01-01')), true);
 assert.equal(reminderOffsetReserved('s', e, 0, '2030-01-01T10:30:00Z'), false);
 assert.equal(reminderOffsetReserved('other', e, 30, '2030-01-01T10:30:00Z'), false);
 const unset = reminderPresentation(reminderLabel('s', { permission: 'granted', stored: [], scheduled: [] }));
 const unknown = reminderPresentation(reminderLabel('s', null));
 assert.equal(unset.title, '알림 미설정'); assert.equal(unknown.title, '알림 확인 필요');
 assert.notEqual(unset.background, unknown.background);
 assert.notEqual(unset.background, reminderPresentation(label).background);
});
test('closing an edit sheet invalidates a late detail response before another record is opened', async () => {
 const names = ['loadTaskEditorDetails', 'closeTaskEditor']; const found = [];
 function walk(n) { if (ts.isFunctionDeclaration(n) && names.includes(n.name?.text)) found.push(n.getText(ast)); ts.forEachChild(n, walk); }
 walk(ast); assert.equal(found.length, 2);
 const code = found.join('\n'); let release; let titles = [];
 const scope = { session: {}, client: {}, editBusy: false, editLoading: false, editReadEpoch: { current: 0 },
   getFreshAccessToken: async () => 'synthetic', readWorklogDetails: () => new Promise(resolve => { release = resolve; }), messageOf: (_e, fallback) => fallback };
 for (const name of new Set(code.match(/setEdit[A-Za-z]+/g))) scope[name] = () => {};
 scope.setEditTitle = title => titles.push(title);
 const api = compile(`${code}\nreturn {loadTaskEditorDetails,closeTaskEditor};`, scope);
 const pending = api.loadTaskEditorDetails('synthetic-record'); await new Promise(resolve => setImmediate(resolve));
 api.closeTaskEditor(); release({title:'late private record', dueDate:'2030-01-01'}); await pending;
 assert.deepEqual(titles, ['']);
});
