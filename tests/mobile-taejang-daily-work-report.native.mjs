import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, register } from 'node:module';
import test from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';

register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const api = await import('../mobile/src/features/daily-work-report/daily-work-report-api.ts');
const { seoulDate } = await import('../mobile/src/features/home/home-calendar-model.ts');
const { mobileTheme } = await import('../mobile/src/ui/theme.ts');
const { workspaceStyles } = await import('../mobile/src/ui/workspace-styles.ts');
const requireMobile = createRequire(new URL('../mobile/package.json', import.meta.url));
const React = requireMobile('react');
const { act, create } = requireMobile('react-test-renderer');
const ts = requireMobile('typescript');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ownerId = 'synthetic-taejang-lead';
const config = { dataSchema: 'worklog', supabaseUrl: 'https://fixture.invalid', publishableKey: 'public-fixture' };
const ownReport = {
  id: 1, author_name: '가상 팀장', can_edit: true, revision: 1, work_date: '2026-11-25',
  morning: true, afternoon: false, work_done: 'ERP에서 작성한 가상 업무', staff_notes: '가상 특이사항', other_notes: '가상 보고',
};
const selected = {
  id: '20000000-0000-4000-8000-000000000001', title: '가상 포장 점검', starts_at: '2026-11-25T09:00+09:00',
  all_day: false, updated_at: '2026-11-24T00:00:00Z',
};
const personal = { ...selected, id: '20000000-0000-4000-8000-000000000002', title: '가상 개인 일정', all_day: true };
const endpoint = name => config.supabaseUrl + '/rest/v1/rpc/' + name;
const rpcError = (message, status = 403) => Response.json({ message }, { status });

const source = readFileSync(new URL('../mobile/src/features/daily-work-report/daily-work-report.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;

async function mount(transport, options = {}) {
  let authChange;
  let active;
  let actor = options.actor ?? ownerId;
  const auth = {
    getSession: async () => ({ data: { session: { access_token: 'synthetic-owner-token' } } }),
    getUser: async token => {
      assert.equal(token, 'synthetic-owner-token');
      return { data: { user: { id: actor } } };
    },
    onAuthStateChange: listener => {
      authChange = listener;
      return { data: { subscription: { unsubscribe() {} } } };
    },
  };
  const native = Object.fromEntries(
    ['ActivityIndicator', 'KeyboardAvoidingView', 'Modal', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View'].map(tag => [tag, tag]),
  );
  native.StyleSheet = { create: value => value };
  native.Platform = { OS: 'web' };
  native.Alert = { alert() {} };
  native.AppState = { addEventListener: (_, listener) => { active = listener; return { remove() {} }; } };
  const imports = {
    react: React,
    'react-native': native,
    '@react-native-community/datetimepicker': { default: 'DateTimePicker' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@/src/ui/theme': { mobileTheme },
    '@/src/ui/workspace-styles': { workspaceStyles },
    '../home/home-calendar-model': { seoulDate },
    './daily-work-report-api': { ...api, dailyReportApi: access => api.dailyReportApi(access, transport) },
  };
  const exports = {};
  new Function('React', 'require', 'exports', code)(React, name => imports[name], exports);
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(exports.TaejangDailyReport, { client: { auth }, config, ownerId }));
    await tick();
  });
  const root = () => renderer.root;
  const text = node => typeof node === 'string' ? node : (node?.children ?? []).map(text).join('');
  const buttons = label => root().findAllByType('Pressable')
    .filter(node => (node.props.accessibilityLabel ?? text(node)).includes(label));
  return {
    buttons,
    content: () => root().findAllByType('Text').map(text).join('\n'),
    input: label => root().findAllByType('TextInput').find(node => node.props.accessibilityLabel === label),
    press: async label => {
      const button = buttons(label)[0];
      assert.ok(button, label);
      assert.notEqual(button.props.disabled, true, label);
      await act(async () => { button.props.onPress(); await tick(); });
    },
    type: async (label, value) => {
      const field = root().findAllByType('TextInput').find(node => node.props.accessibilityLabel === label);
      assert.ok(field, label);
      await act(async () => field.props.onChangeText(value));
    },
    switchAccount: () => act(async () => { actor = 'different-user'; authChange('SIGNED_IN', { user: { id: actor } }); }),
    foreground: () => act(async () => { active('active'); await tick(); }),
    close: () => act(async () => renderer.unmount()),
  };
}

test('mobile reopens the ERP report, requires schedule preview, and retains input on a revision conflict', async () => {
  const calls = [];
  let row = ownReport;
  let conflict = true;
  const transport = async (url, request) => {
    assert.equal(request.headers.authorization, 'Bearer synthetic-owner-token');
    const name = url.split('/').at(-1);
    assert.equal(url, endpoint(name));
    const body = JSON.parse(request.body);
    calls.push({ name, body });
    switch (name) {
      case 'get_daily_work_report_access': return Response.json({ author_name: row.author_name, can_read_all: false });
      case 'search_daily_work_reports': return Response.json([row]);
      case 'list_daily_work_report_schedules': return Response.json([selected, personal]);
      case 'save_daily_work_report_with_schedules':
        if (conflict) return rpcError('DAILY_WORK_CONFLICT', 400);
        row = { ...row, afternoon: body.p_afternoon, work_done: body.p_work + '\n- ' + selected.title, revision: 2 };
        return Response.json(row);
      default: throw Error('unexpected endpoint ' + name);
    }
  };
  const ui = await mount(transport);
  try {
    await ui.press('태장 일일 업무일지');
    await ui.press('2026-11-25 · 가상 팀장');
    assert.equal(ui.input('오늘의 업무 내용').props.value, ownReport.work_done);
    assert.match(ui.content(), /이사 확인란[\s\S]*대표 확인란/);
    await ui.press('오후');
    await ui.type('오늘의 업무 내용', ownReport.work_done + '\n앱에서 덧붙인 내용');
    await ui.press('업무수첩 일정 가져오기');
    assert.deepEqual(calls.find(e => e.name === 'list_daily_work_report_schedules').body, { p_date: '2026-11-25' });
    await ui.press(selected.title);
    assert.equal(ui.buttons('일지 저장')[0].props.disabled, true);
    await ui.press('선택 일정 미리보기');
    assert.match(ui.content(), /업무 내용에 추가할 일정/);
    assert.doesNotMatch(ui.content(), /가상 개인 일정/);
    assert.equal(calls.find(e => e.name.startsWith('save_')), undefined);
    await ui.press('일지 저장');
    assert.match(ui.content(), /다른 화면에서/);
    assert.equal(ui.input('오늘의 업무 내용').props.value, ownReport.work_done + '\n앱에서 덧붙인 내용');
    const sent = calls.find(e => e.name.startsWith('save_')).body;
    assert.equal(sent.p_revision, 1);
    assert.equal(sent.p_afternoon, true);
    assert.deepEqual(sent.p_schedules, [{ id: selected.id, updated_at: selected.updated_at }]);
    assert.equal(sent.p_staff, ownReport.staff_notes);
    assert.equal(sent.p_other, ownReport.other_notes);
    conflict = false;
    await ui.press('일지 저장');
    assert.equal(ui.input('오늘의 업무 내용').props.value, row.work_done);
    await ui.press('일지 목록');
    await ui.press('2026-11-25 · 가상 팀장');
    assert.equal(ui.input('오늘의 업무 내용').props.value, row.work_done);
  } finally { await ui.close(); }
});

test('unauthorized and preview roles hide the entry, and a downgraded supervisor loses the displayed report', async () => {
  let allowed = false;
  let calls = 0;
  const other = { ...ownReport, can_edit: false };
  const transport = async url => {
    calls++;
    if (!allowed) return rpcError('DAILY_WORK_FORBIDDEN');
    return Response.json(url === endpoint('get_daily_work_report_access')
      ? { author_name: '가상 총괄', can_read_all: true } : [other]);
  };
  const ui = await mount(transport);
  try {
    assert.equal(ui.buttons('태장 일일 업무일지').length, 0);
    assert.equal(calls, 1, 'staff without a grant never requests report rows');
    allowed = true;
    await ui.foreground();
    await ui.press('태장 일일 업무일지');
    await ui.press('2026-11-25 · 가상 팀장');
    assert.match(ui.content(), /읽기 전용[\s\S]*ERP에서 작성한 가상 업무/);
    assert.equal(ui.buttons('일지 저장').length, 0);
    assert.equal(ui.buttons('업무수첩 일정 가져오기').length, 0);
    allowed = false;
    await ui.foreground();
    assert.equal(ui.buttons('태장 일일 업무일지').length, 0);
    assert.doesNotMatch(ui.content(), /ERP에서 작성한 가상 업무/);
  } finally { await ui.close(); }
});

test('account switch closes report access and ignores a response already in flight', async () => {
  let returnRows;
  const transport = async url => url === endpoint('get_daily_work_report_access')
    ? Response.json({ author_name: '가상 팀장', can_read_all: false })
    : new Promise(resolve => { returnRows = resolve; });
  const ui = await mount(transport);
  try {
    await ui.press('태장 일일 업무일지');
    assert.equal(typeof returnRows, 'function');
    await ui.switchAccount();
    await act(async () => { returnRows(Response.json([ownReport])); await tick(); });
    assert.equal(ui.buttons('태장 일일 업무일지').length, 0);
    assert.doesNotMatch(ui.content(), /가상 업무/);
  } finally { await ui.close(); }
});
