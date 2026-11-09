import test from 'node:test';
import assert from 'node:assert/strict';
import { homeHarness, nodes, words } from './helpers/mobile-home-harness.mjs';
import { register } from 'node:module';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { firstNonEmptyTaskBucket, homeOverview } = await import('../mobile/src/features/home/home-overview.ts');
export function fixture(kind) {
 const briefing = { today: '2026-10-26', scheduleEnabled: true, structure: {}, schedules: { today: [], upcoming: [] } };
 if (['overdue', 'mixed'].includes(kind)) briefing.structure.overdue = [{ pageId: 'task-1', title: '합성 지난 업무', dueKey: '2026-10-25' }];
 if (['populated', 'mixed'].includes(kind)) briefing.structure.today = [{ pageId: 'task-2', title: '합성 오늘 업무', dueKey: briefing.today }];
 if (['schedules', 'mixed'].includes(kind)) { briefing.schedules.today = [{ scheduleId: 's-1', title: '합성 오전 일정', startsAt: '2026-10-26T01:00:00Z' }]; briefing.schedules.upcoming = [{ scheduleId: 's-2', title: '합성 다음 일정', startsAt: '2026-10-27T01:00:00Z' }]; }
 const overview = homeOverview(briefing);
 return { briefing, overview, structure: overview.structure, activeFilter: firstNonEmptyTaskBucket(overview.structure) };
}
for (const kind of ['empty','populated','overdue','schedules','mixed']) test(`current home JSX renders ${kind} with one action row per filtered task`, () => {
 const h = homeHarness(fixture(kind));
 const text = words(h.render());
 assert.equal(nodes([h.render(),h.photo()]).filter(n => n.type === 'CaptureImportButton').length,2);
 assert.equal(nodes(h.render()).filter(n => n.type === 'CaptureImportButton' && n.props.label === '캡처 등록').length,1);
 assert.equal(h.photo().props.compact,true);assert.equal(h.photo(true).props.disabled,true);
 assert.match(text, /할 일/);
 assert.doesNotMatch(text, /오늘 한눈에/);
 for (const key of ['today','overdue','upcoming','undated']) {
  h.context.setTaskFilter(key); const tree = h.render();
  assert.equal(nodes(tree).filter(n => n.props?.accessibilityLabel?.endsWith('완료 처리')).length, h.context.structure[key].length);
 }
 const calendar = nodes(h.render()).find(n => n.type === 'HomeCalendar');
 assert.ok(calendar);
 if (kind === 'mixed' || kind === 'schedules') assert.equal(calendar.props.fallback.length, 2);
});
test('direct delete remains a single action that forwards to the existing confirmation', () => {
 const h = homeHarness(fixture('populated')); let confirmations = 0;
 h.context.confirmDeleteRecord = () => confirmations++;
 const expand = nodes(h.render()).find(n => n.props?.accessibilityLabel?.endsWith('관리 펼치기'));
 assert.ok(expand); expand.props.onPress();
 const tree = h.render();
 const remove = nodes(tree).find(n => n.type === 'Pressable' && n.props?.accessibilityLabel?.endsWith(' 삭제'));
 assert.ok(remove); assert.doesNotMatch(words(tree), /•••|닫기/);
 assert.equal(confirmations, 0); remove.props.onPress(); assert.equal(confirmations, 1);
});
