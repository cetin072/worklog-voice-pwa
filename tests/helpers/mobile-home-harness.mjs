import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../mobile/package.json', import.meta.url));
const ts = require('typescript');
const source = readFileSync(new URL('../../mobile/app/index.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('home.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['taskNote', 'formatSchedule', 'ReminderShortcut', 'TaskRow', 'NoteRow', 'formatNoteJournalDate', 'ScheduleRows'];
const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name.text)).map(node => node.getText(ast)).join('\n');
const start = source.indexOf("{screen === 'home' ? <>") + "{screen === 'home' ? ".length;
const end = source.indexOf("\n    {screen === 'journal'", start);
const home = source.slice(start, end).trim().replace(/ : null\}$/, '');
const compiled = ts.transpileModule(`${declarations}\nfunction renderHome() { return (${home}); }\nreturn { renderHome, TaskRow };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
export function homeHarness(context) {
 const states = []; let cursor = 0; let back; let cleanup;
 const node = (type, props, ...children) => ({ type, props: { ...props, children } });
 const base = { React: { createElement: node, Fragment: 'Fragment' }, View: 'View', Text: 'Text', Pressable: 'Pressable', Button: 'Button', ActivityIndicator: 'ActivityIndicator',
  useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
  useEffect(fn) { cleanup?.(); cleanup = fn(); }, BackHandler: { addEventListener(_name, fn) { back = fn; return { remove() { back = null; } }; } },
  styles: new Proxy({}, { get: (_o, key) => key }), sectionToneStyles: {},
  ScheduleReminderLabel: props => node('Text', {}, '알림 확인 필요'), MeetingRecordingBanner: () => null,
  lastDirectSave: null, briefingInfo: { heading: '오늘의 브리핑', warnings: [] }, briefingBusy: false, briefingError: '', notificationScheduleId: null,
  briefingNow: 0, reminderTarget: null, upcomingExpanded: false, expandedBuckets: {}, taskBusyId: null, noteBusyId: null, notes: [], visibleNotes: [], extraNotes: 0,
  undoTask: null, undoPostpone: null, undoAttention: null, undoNote: null, message: '', overview: {},
  briefingBuckets: [{ key: 'today', label: '오늘', tone: 'warning' }, { key: 'overdue', label: '기한 지남', tone: 'danger' }, { key: 'upcoming', label: '다가오는 업무', tone: 'info' }, { key: 'undated', label: '기한 없는 업무', tone: 'neutral' }],
  refreshBriefing() {}, setScreen() {}, setReminderTarget() {}, setSelectedTask() {}, openTaskEditor() {}, confirmDeleteRecord() {}, completeTaskInline() {},
  ...context,
 };
 base.setTaskFilter = key => { base.activeFilter = key; };
 base.setUpcomingExpanded = update => { base.upcomingExpanded = update(base.upcomingExpanded); };
 base.setExpandedBuckets = update => { base.expandedBuckets = update(base.expandedBuckets); };
 const api = new Function('scope', `with(scope) { ${compiled} }`)(base);
 function expand(value) {
  if (Array.isArray(value)) return value.flatMap(expand);
  if (!value || typeof value !== 'object') return value;
  if (typeof value.type === 'function') return expand(value.type(value.props));
  return { ...value, props: { ...value.props, children: expand(value.props.children) } };
 }
 return { context: base, render() { cursor = 0; return expand(api.renderHome()); }, back() { return back?.(); } };
}
export function nodes(tree) { return Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : []; }
export function words(tree) { return Array.isArray(tree) ? tree.map(words).join(' ') : tree && typeof tree === 'object' ? words(tree.props?.children) : String(tree ?? ''); }
