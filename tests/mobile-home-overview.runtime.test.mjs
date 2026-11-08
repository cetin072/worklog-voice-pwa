import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { firstNonEmptyTaskBucket, homeOverview } = await import('../mobile/src/features/home/home-overview.ts');
const { reminderLabel } = await import('../mobile/src/features/home/reminder-label.ts');
const task = { pageId: 'synthetic-task', title: '검수용 업무', dueKey: '2026-10-25' };
test('empty, overdue-only, schedules-only and mixed data retain separate identities and accurate displayed counts', () => {
 assert.equal(homeOverview({}).empty, true);
 const data = { today: '2026-10-26', structure: { overdue: [task] }, resurface: [task], schedules: { today: [{ scheduleId: 'synthetic-task' }] } };
 const copy = JSON.stringify(data);
 const model = homeOverview(data);
 assert.equal(model.structure.overdue.length, 1);
 assert.match(model.summary, /기한 지남 1/);
 assert.match(model.summary, /오늘 일정 1개/);
 assert.equal(JSON.stringify(data), copy);
 assert.equal(homeOverview({ schedules: { today: [{}] } }).empty, false);
 assert.equal(homeOverview({ structure: { overdue: [task] } }).empty, false);
 assert.equal(homeOverview({ notes: [{ title: '합성 메모' }] }).empty, false);
});
test('attention-only tasks remain reachable and repeated identities appear once in actionable buckets', () => {
 const model = homeOverview({ today: '2026-10-26', structure: { today: [task], overdue: [task] }, resurface: [task, { pageId: 'attention', reason: 'attention' }] });
 assert.equal(Object.values(model.structure).flat().length, 2);
 assert.equal(model.structure.undated[0].pageId, 'attention');
});
test('unknown, blocked, unset, stored-only, pending and native confirmed reservations are distinguished', () => {
 const stored = [{ identifier: 'native-id', offsetMinutes: 30, triggerAt: '2030-01-01T10:00:00Z', title: '합성 일정' }];
 const evidence = { permission: 'granted', stored: [], scheduled: [] };
 assert.equal(reminderLabel('s', null), '알림 확인 필요');
 assert.match(reminderLabel('s', { ...evidence, permission: 'denied' }), /권한 차단/);
 assert.match(reminderLabel('s', evidence), /알림 없음/);
 assert.match(reminderLabel('s', { ...evidence, stored }), /예약 확인 필요/);
 assert.equal(reminderLabel('s', { ...evidence, pending: true }), '알림 확인 필요');
 const scheduled = [{ identifier: 'native-id', content: { body: '합성 일정', data: { target: 'schedule', scheduleId: 's', offsetMinutes: 30, triggerAt: stored[0].triggerAt } } }];
 assert.match(reminderLabel('s', { ...evidence, stored, scheduled }), /예약: 30분 전/);
 assert.match(reminderLabel('s', { ...evidence, stored, scheduled }, Date.now(), '2030-01-02T10:30:00Z'), /예약 확인 필요/);
 assert.match(reminderLabel('other-account-schedule', { ...evidence, stored, scheduled }), /예약 확인 필요/);
 assert.match(reminderLabel('s', { ...evidence, stored, scheduled }, Date.parse('2031-01-01')), /예약 확인 필요/);
});

test('Home defaults to a non-empty task group without changing explicitly selected filters', () => {
  const futureOnly = homeOverview({ today: '2026-11-08', structure: {
    upcoming: [{ pageId: 'future', title: '서류 확인', dueKey: '2026-11-12' }],
  } });
  const undatedOnly = homeOverview({ structure: {
    undated: [{ pageId: 'undated', title: '검토' }],
  } });
  const overdueAndFuture = homeOverview({ structure: {
    overdue: [{ pageId: 'late', title: '지난 업무' }],
    upcoming: [{ pageId: 'next', title: '다음 업무' }],
  } });
  const todayAndOverdue = homeOverview({ structure: {
    today: [{ pageId: 'today', title: '오늘 업무' }],
    overdue: [{ pageId: 'late', title: '지난 업무' }],
  } });
  assert.equal(firstNonEmptyTaskBucket(futureOnly.structure), 'upcoming');
  assert.equal(firstNonEmptyTaskBucket(undatedOnly.structure), 'undated');
  assert.equal(firstNonEmptyTaskBucket(overdueAndFuture.structure), 'overdue');
  assert.equal(firstNonEmptyTaskBucket(todayAndOverdue.structure), 'today');
  assert.equal(firstNonEmptyTaskBucket(homeOverview({}).structure), 'today');
  // The app uses this only if the user has not selected a filter.
  assert.match(readFileSync('mobile/app/index.tsx', 'utf8'), /taskFilter \|\| firstNonEmptyTaskBucket\(structure\)/);
});


test('new schedule focus never calls a 14-day briefing omission a failed save', () => {
  const source = readFileSync('mobile/app/index.tsx', 'utf8');
  assert.match(source, /empty=\{scheduleFocusReason === 'created'/);
  assert.match(source, /이 화면은 오늘과 14일 이내 일정만 보여주므로/);
  assert.match(source, /표시되지 않는다고 저장이 누락된 것은 아닙니다/);
  assert.match(source, /목록을 새로고침하거나 해당 날짜의 업무일지에서 확인해주세요/);
  assert.doesNotMatch(source, /empty="연결된 일정을 찾지 못했습니다\."/);
});


test('notes-only and schedules-only Home show their content without empty task filters', () => {
  const memoOnly = homeOverview({
    today: '2026-11-08',
    notes: [{ pageId: 'note-1', title: '회의 결과 기록' }],
  });
  const scheduleOnly = homeOverview({
    today: '2026-11-08',
    schedules: { today: [{ scheduleId: 'schedule-1', title: '상담 예약' }] },
  });
  const mixed = homeOverview({
    today: '2026-11-08',
    structure: { upcoming: [{ pageId: 'task-1', title: '내일 서류 확인' }] },
    notes: [{ pageId: 'note-1', title: '회의 결과 기록' }],
  });
  for (const emptyTasks of [memoOnly, scheduleOnly]) {
    assert.equal(emptyTasks.empty, false, 'the Home contains real notes or schedules');
    assert.equal(emptyTasks.hasTasks, false, 'there are no action-ready task rows');
    assert.equal(Object.values(emptyTasks.structure).flat().length, 0);
  }
  assert.equal(mixed.hasTasks, true);
  assert.equal(mixed.structure.upcoming.length, 1);
  const source = readFileSync('mobile/app/index.tsx', 'utf8');
  assert.match(source, /\{overview\.hasTasks \? <View style=\{styles\.homeFilters\}>/);
  assert.match(source, /\{briefing && overview\.hasTasks \? briefingBuckets\.filter/);
  assert.match(source, /\{notes\.length \? <View style=\{\[styles\.briefingSection/);
  assert.match(source, /\{briefing\?\.scheduleEnabled && !overview\.empty \?/,
    'do not hide valid schedule section when no task rows exist');
});
