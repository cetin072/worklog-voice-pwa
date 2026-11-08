import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, register } from 'node:module';
const blobs = `const store={get:async()=>null,setJSON:async()=>{}};export const getStore=()=>store;export const getDeployStore=()=>store;`;
register('./helpers/mobile-ts-loader.mjs', import.meta.url, { data: { mocks: {
  '@netlify/blobs': `data:text/javascript,${encodeURIComponent(blobs)}`,
} } });
const { createManualWorkSaveSession } = await import('../mobile/src/features/work/manual-work-save.ts');
const { saveWorklog } = await import('../mobile/src/platform/worklog-api.ts');
const { default: handler } = await import('../netlify/functions/worklog.mts');
const ts = createRequire(new URL('../mobile/package.json', import.meta.url))('typescript');
const ast = ts.createSourceFile('home.tsx', readFileSync('mobile/app/index.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function directSave(scope) {
  let declaration;
  function walk(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'persistDraft') declaration = node; ts.forEachChild(node, walk); }
  walk(ast); assert.ok(declaration);
  const js = ts.transpileModule(declaration.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function('scope', `with(scope) { ${js}; return persistDraft; }`)(scope);
}
function ui(input, saver) {
  const state = { messages: [], cleared: 0, calls: 0 };
  const scope = {
    session: { access_token: 'expired-token' }, client: {}, busy: false, manualInput: input,
    getFreshAccessToken: async () => 'synthetic-token',
    manualSaveSession: { current: createManualWorkSaveSession() }, manualSaveInFlight: { current: false },
    reminderFailureMessage: () => '알림 확인 필요',
    saveWorklog: (...args) => { state.calls++; return saver(...args); },
    run: fn => fn(), reminderSessionEpoch: { capture: () => () => true },
    synchronizeSavedScheduleReminders: async () => [], savedReminderMessage: () => '',
    setSavedReminder() {}, maybeGuideExactAlarmPermission: async () => {},
    emptyManualWorkInput: () => ({ transcript: '', dueDate: '', dueTime: '' }),
    setManualInput: () => { state.cleared++; }, setLastDirectSave: value => { state.feedback = value; },
    setNotificationScheduleId() {}, setScheduleFocusReason() {}, formatSavedDue: value => value,
    showMessage: (value, tone) => state.messages.push({ value, tone }), setScreen() {}, refreshBriefing: async () => {},
  };
  return { state, scope, save: directSave(scope) };
}

test('actual direct-save UI → mobile HTTP → handler → RPC keeps picker date/time and creates schedule for short titles', async () => {
  const previousFetch = globalThis.fetch, previousNetlify = globalThis.Netlify;
  globalThis.Netlify = { env: { get: key => ({ WORKLOG_DATA_CORE_PRIMARY_ENABLED: 'true', SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_PUBLISHABLE_KEY: 'synthetic-key', WORKLOG_DATA_SCHEMA: 'worklog' })[key] } };
  try {
    for (const transcript of ['테스트 회의 — 합성 사무소', '합성 담당자']) {
      const requests = [], writes = [];
      globalThis.fetch = async (input, init) => {
        const url = new URL(input);
        if (url.pathname === '/api/worklog') {
          requests.push(JSON.parse(init.body));
          return handler(new Request(url, init), {});
        }
        if (url.pathname === '/api/record-normalize') return Response.json({}, { status: 202 });
        assert.equal(url.origin, 'https://synthetic.invalid');
        assert.equal(url.pathname, '/rest/v1/rpc/save_my_worklog_with_schedule_v2');
        assert.equal(init.headers['Content-Profile'], 'worklog');
        const p = JSON.parse(init.body); writes.push(p);
        return Response.json([{
          user_id: '11111111-1111-4111-8111-111111111111', workspace_id: '22222222-2222-4222-8222-222222222222',
          work_record_id: '33333333-3333-4333-8333-333333333333', source_ref_id: '44444444-4444-4444-8444-444444444444',
          schedule_id: p.p_schedule_title ? '55555555-5555-4555-8555-555555555555' : null,
          title: p.p_schedule_title, starts_at: p.p_schedule_starts_at, status: 'confirmed', all_day: false,
        }]);
      };
      const { state, save } = ui({ transcript, dueDate: '2026-11-06', dueTime: '14:30' }, saveWorklog);
      await save();
      assert.equal(requests.length, 1); assert.equal(writes.length, 1);
      assert.equal(requests[0].transcript, transcript); assert.equal(requests[0].dueDate, '2026-11-06'); assert.equal(requests[0].dueTime, '14:30');
      assert.equal(writes[0].p_due_at, '2026-11-06T14:30:00+09:00');
      assert.equal(writes[0].p_schedule_title, transcript); assert.equal(writes[0].p_schedule_starts_at, '2026-11-06T14:30:00+09:00');
      assert.equal(writes[0].p_metadata.actionEngine.kind, 'schedule');
      assert.equal(state.feedback.scheduleCreated, true); assert.equal(state.feedback.scheduleWarning, '');
      assert.equal(state.messages[0].tone, 'success'); assert.equal(state.cleared, 1);
    }
  } finally { globalThis.fetch = previousFetch; globalThis.Netlify = previousNetlify; }
});

test('old server or incomplete save cannot silently discard requested date/time or claim schedule success; no automatic duplicate write', async () => {
  for (const result of [
    { scheduleCreated: false, dueStart: '' },
    { scheduleCreated: true, scheduleId: 'synthetic-schedule', dueStart: '2026-11-04T14:30:00+09:00' },
    { scheduleCreated: true, dueStart: '2026-11-06T14:30:00+09:00' },
  ]) {
    const { state, save } = ui({ transcript: '합성 담당자', dueDate: '2026-11-06', dueTime: '14:30' }, async () => result);
    await save();
    assert.equal(state.calls, 1); assert.equal(state.cleared, 1);
    assert.equal(state.messages[0].tone, 'error');
    assert.match(state.feedback.scheduleWarning, /2026-11-06 14:30/);
    assert.match(state.feedback.scheduleWarning, /다시 등록하지 말고/);
    assert.equal(state.feedback.transcript, '합성 담당자');
  }
});

test('date-only deadline and equivalent UTC schedule time are accepted; undated memo remains a memo', async () => {
  for (const [dueDate, dueTime, saved] of [
    ['2026-11-06', '', { dueStart: '2026-11-06', scheduleCreated: false }],
    ['2026-11-06', '14:30', { dueStart: '2026-11-06T05:30:00Z', scheduleCreated: true, scheduleId: 'synthetic-schedule' }],
    ['', '', { scheduleCreated: false }],
  ]) {
    const { state, save } = ui({ transcript: '합성 기록', dueDate, dueTime }, async () => saved);
    await save(); assert.equal(state.feedback.scheduleWarning, ''); assert.equal(state.messages[0].tone, 'success');
  }
});

test('actual Home save preserves the request after a lost response and blocks rapid duplicate taps', async () => {
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { state, save } = ui({ transcript: '서류 확인', dueDate: '2026-11-12', dueTime: '15:00' }, async (token, text, options) => {
    calls.push({ token, text, ...options });
    if (calls.length === 1) { await gate; throw new Error('response lost after save'); }
    return { pageId: 'saved', dueStart: '2026-11-12T15:00:00+09:00', scheduleCreated: true, scheduleId: 'schedule' };
  });
  const first = save();
  await save();
  release();
  await assert.rejects(first, /response lost/);
  assert.equal(calls.length, 1); assert.equal(state.cleared, 0);
  await save();
  assert.deepEqual(calls[1], calls[0]);
  assert.equal(state.cleared, 1); assert.equal(state.feedback.scheduleCreated, true);
});

test('actual Home keeps save success and clears input when post-save permission guidance throws', async () => {
  const { state, scope, save } = ui({ transcript: '서류 확인', dueDate: '2026-11-12', dueTime: '15:00' }, async () => ({
    pageId: 'saved', dueStart: '2026-11-12T15:00:00+09:00', scheduleCreated: true, scheduleId: 'schedule',
  }));
  scope.maybeGuideExactAlarmPermission = async () => { throw new Error('permission storage failed'); };
  scope.setSavedReminder = value => { state.reminder = value; };
  await save();
  assert.equal(state.calls, 1); assert.equal(state.cleared, 1);
  assert.equal(state.feedback.scheduleCreated, true);
  assert.equal(state.messages[0].tone, 'success');
  assert.match(state.messages[0].value, /알림 확인 필요/);
  assert.equal(state.reminder.message, '알림 확인 필요');
});


test('direct input refreshes a stale token without changing the retained idempotency payload', async () => {
  const calls = [];
  const { scope, save } = ui({ transcript: '합성 서류 확인', dueDate: '', dueTime: '' },
    async (token, transcript, options) => { calls.push({ token, transcript, options }); return { pageId: 'synthetic-record', scheduleCreated: false }; });
  scope.getFreshAccessToken = async () => 'fresh-token-after-session-renewal';
  await save();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].token, 'fresh-token-after-session-renewal');
  assert.equal(calls[0].transcript, '합성 서류 확인');
  assert.ok(calls[0].options.clientRequestId);
});
