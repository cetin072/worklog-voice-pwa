import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeComponentHarness, nativeNodes, nativeWords } from './helpers/native-component-harness.mjs';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../mobile/app/index.tsx', import.meta.url), 'utf8');

test('Android date picker dismisses without changing the review date or deadline', () => {
  const calls = [];
  const view = nativeComponentHarness('mobile/src/features/work/task-reminder-actions.tsx', 'TaskReminderActions', {
    '@react-native-community/datetimepicker': { __esModule: true, default: 'DateTimePicker' },
    '@/src/ui/theme': { mobileTheme: { colors: {} } },
    '@/src/features/home/home-calendar-model': {
      seoulDate: () => '2026-11-20',
      shiftDay: (_day, count) => count === 1 ? '2026-11-21' : '2026-11-27',
    },
  });
  const props = {
    hasAttention: true,
    attentionDate: '2026-11-24',
    onAttention: date => calls.push(['review', date]),
    onClearAttention: () => calls.push(['clear']),
  };
  const buttons = (tree, text) => nativeNodes(tree).filter(node => node.type === 'Pressable' && nativeWords(node).trim() === text);
  const picker = tree => nativeNodes(tree).find(node => node.type === 'DateTimePicker');

  let tree = view.render(props);
  assert.match(nativeWords(tree), /설정된 날짜\s+2026-11-24/);
  assert.doesNotMatch(nativeWords(tree), /기한 미루기/);
  buttons(tree, '직접 선택')[0].props.onPress();
  let control = picker(view.render(props));
  assert.equal(control.props.value.getDate(), 24);
  control.props.onChange({ type: 'dismissed' }, control.props.value);
  assert.equal(picker(view.render(props)), undefined);
  assert.deepEqual(calls, []);

  buttons(view.render(props), '직접 선택')[0].props.onPress();
  control = picker(view.render(props));
  control.props.onChange({ type: 'set' }, new Date(2026, 10, 26, 12));
  assert.equal(picker(view.render(props)), undefined);
  assert.deepEqual(calls, [['review', '2026-11-26']]);

  props.onPostpone = date => calls.push(['postpone', date]);
  tree = view.render(props);
  assert.match(nativeWords(tree), /기한 미루기/);
  buttons(tree, '직접 선택')[0].props.onPress();
  control = picker(view.render(props));
  control.props.onChange({ type: 'dismissed' }, control.props.value);
  assert.deepEqual(calls, [['review', '2026-11-26']]);
});

test('Android back restores the same route as the visible close control', () => {
  const handler = app.slice(app.indexOf("BackHandler.addEventListener('hardwareBackPress'"), app.indexOf('return () => subscription.remove();', app.indexOf("BackHandler.addEventListener('hardwareBackPress'")));
  const callback = handler.slice(handler.indexOf('() => {'), handler.lastIndexOf('});') + 1);
  for (const screen of ['task', 'journal', 'recordSearch']) {
    const seen = [];
    const run = new Function('screen', 'setScreen', 'quickVoiceNavigation', 'taskReturn', 'journalReturn', 'searchReturn', 'return (' + callback + ')()');
    assert.equal(run(screen, value => seen.push(value), { current: false }, 'work', 'work', 'work'), true);
    assert.deepEqual(seen, ['work']);
  }
});
