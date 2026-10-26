import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { homeOverview } = await import('../mobile/src/features/home/home-overview.ts');
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
