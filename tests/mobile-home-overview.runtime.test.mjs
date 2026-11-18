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

test('overview retains all buckets; approved Home starts with today and keeps explicit filters', () => {
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
  assert.match(readFileSync('mobile/app/index.tsx', 'utf8'), /firstNonEmptyTaskBucket\(\{ \.\.\.structure, undated: \[\] \}\)/);
});


test('Home keeps schedule focus and notes while moving filters behind the task card disclosure', () => {
  const source = readFileSync('mobile/app/index.tsx', 'utf8');
  assert.match(source, /focusId=\{notificationScheduleId\}/);
  assert.match(source, /focusDate=\{/);
  assert.match(source, /taskFiltersExpanded \? <View style=\{styles.homeFilters\}/);
  assert.doesNotMatch(source, /\{notes.length \? <View/);
  assert.match(source, /전체 업무/);
  assert.match(source, /<HomeCalendar/);
  assert.doesNotMatch(source, /오늘 한눈에/);
});

test('undated review cards open the existing detail without changing deadline counts', async () => {
  const { undatedReviews } = await import('../mobile/src/features/home/home-overview.ts');
  const task = { pageId: 'review', title: '공급조건 다시 보기', nextAttentionAt: '2026-11-18T00:00:00Z' };
  const candidates = [task, task, { ...task, pageId: 'due', dueKey: '2026-11-18' }, { pageId: 'plain', title: '날짜 없는 업무' }];
  const reviewTasks = undatedReviews({ resurface: candidates });
  assert.deepEqual(reviewTasks, [task]);
  const { homeHarness, nodes, words } = await import('./helpers/mobile-home-harness.mjs');
  let selected, screen;
  const app = homeHarness({ briefing: { today: '2026-11-18' }, reviewTasks, briefingBuckets: [],
    structure: { today: [], overdue: [], upcoming: [], undated: [task] },
    setSelectedTask: value => { selected = value; }, setScreen: value => { screen = value; } });
  const tree = app.render();
  assert.match(words(tree), /오늘 마감\s+0.*다시 확인할 업무.*공급조건 다시 보기/s);
  nodes(tree).find(node => node.type === 'Pressable' && words(node).includes(task.title)).props.onPress();
  assert.deepEqual(selected, { bucket: 'undated', task });
  assert.equal(screen, 'task');
  assert.ok(nodes(tree).some(node => node.props?.accessibilityLabel === '공급조건 다시 보기 확인했어요'));
});

test('confirming a Home review removes that instance only after a successful write', async () => {
  const { homeHarness } = await import('./helpers/mobile-home-harness.mjs');
  const task = { pageId: 'review', title: '공급조건', nextAttentionAt: '2026-11-18T00:00:00.000Z' };
  const rescheduled = { ...task, nextAttentionAt: '2026-11-20T00:00:00.000Z' };
  const structure = { undated: [task] };
  let briefing = { resurface: [task, rescheduled], structure };
  let writeError = new Error('stale');
  let refreshed = 0;
  let message = '';
  let currentAccount = true;
  const calls = [];
  const app = homeHarness({
    client: {}, reminderMutationInFlight: { current: false },
    reminderSessionEpoch: { capture: () => () => currentAccount },
    briefingRefreshQueue: { current: { run: run => run() } },
    getFreshAccessToken: async () => 'current-token',
    undoWorklogAttention: async (...args) => {
      calls.push(args);
      if (writeError) throw writeError;
    },
    setBriefing: update => { briefing = update(briefing); },
    refreshBriefing: async () => { refreshed++; },
    setReminderBusyId() {}, clearMessage() {},
    messageOf: error => error.message,
    showMessage: value => { message = value; },
  });
  await app.acknowledgeTaskReview(task);
  assert.deepEqual(briefing.resurface, [task, rescheduled]);
  assert.equal(message, 'stale');
  assert.equal(refreshed, 1);
  writeError = null;
  await app.acknowledgeTaskReview(task);
  assert.deepEqual(calls[1], ['current-token', task.pageId, task.nextAttentionAt, null]);
  assert.deepEqual(briefing.resurface, [rescheduled]);
  assert.equal(briefing.structure, structure);
  currentAccount = false;
  await app.acknowledgeTaskReview(rescheduled);
  assert.equal(calls.length, 2);
  assert.deepEqual(briefing.resurface, [rescheduled]);
});
