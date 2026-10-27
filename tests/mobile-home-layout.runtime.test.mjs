import test from 'node:test';
import assert from 'node:assert/strict';
import { homeHarness, nodes, words } from './helpers/mobile-home-harness.mjs';
import { register } from 'node:module';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { homeOverview } = await import('../mobile/src/features/home/home-overview.ts');
export function fixture(kind) {
 const briefing = { today: '2026-10-26', scheduleEnabled: true, structure: {}, schedules: { today: [], upcoming: [] } };
 if (['overdue', 'mixed'].includes(kind)) briefing.structure.overdue = [{ pageId: 'task-1', title: '합성 지난 업무', dueKey: '2026-10-25' }];
 if (['populated', 'mixed'].includes(kind)) briefing.structure.today = [{ pageId: 'task-2', title: '합성 오늘 업무', dueKey: briefing.today }];
 if (['schedules', 'mixed'].includes(kind)) { briefing.schedules.today = [{ scheduleId: 's-1', title: '합성 오전 일정', startsAt: '2026-10-26T01:00:00Z' }]; briefing.schedules.upcoming = [{ scheduleId: 's-2', title: '합성 다음 일정', startsAt: '2026-10-27T01:00:00Z' }]; }
 const overview = homeOverview(briefing);
 return { briefing, overview, structure: overview.structure, activeFilter: overview.structure.today.length ? 'today' : overview.structure.overdue.length ? 'overdue' : 'today' };
}
for (const kind of ['empty','populated','overdue','schedules','mixed']) test(`current home JSX renders ${kind} with one action row per filtered task`, () => {
 const h = homeHarness(fixture(kind));
 const text = words(h.render());
 assert.match(text, /오늘 한눈에/);
 if (kind === 'empty') assert.doesNotMatch(text, /오늘 확정 일정이 없습니다/);
 for (const key of ['today','overdue','upcoming','undated']) {
  h.context.setTaskFilter(key); const tree = h.render();
  assert.equal(nodes(tree).filter(n => n.props?.accessibilityLabel?.endsWith('완료 처리')).length, h.context.structure[key].length);
 }
 h.context.setUpcomingExpanded(v => !v);
 if (kind === 'mixed' || kind === 'schedules') assert.match(words(h.render()), /합성 다음 일정/);
});
test('direct delete remains a single action that forwards to the existing confirmation', () => {
 const h = homeHarness(fixture('populated')); let confirmations = 0;
 h.context.confirmDeleteRecord = () => confirmations++;
 const tree = h.render();
 const remove = nodes(tree).find(n => n.type === 'Pressable' && n.props?.accessibilityLabel?.endsWith(' 삭제'));
 assert.ok(remove); assert.doesNotMatch(words(tree), /•••|닫기/);
 assert.equal(confirmations, 0); remove.props.onPress(); assert.equal(confirmations, 1);
});
