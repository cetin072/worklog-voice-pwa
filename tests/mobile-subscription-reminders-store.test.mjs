import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const plan = await import('../mobile/src/features/subscriptions/subscription-reminder-plan.ts');
const store = await import('../mobile/src/features/subscriptions/subscription-store.ts');

const sub = (o = {}) => ({
  id: 's1', name: '클라우드', amountKrw: 12000, cycle: 'monthly', scope: 'business',
  billingAnchorDate: '2026-11-15', cancelDeadline: null, lastUsedDate: null, createdAt: '2026-11-01T00:00:00Z', ...o,
});
const NOW = Date.parse('2026-11-09T11:00:00+09:00');

test('알림은 결제일/해지기한 하루 전 오전 9시(서울)에 걸린다', () => {
  const p = plan.planSubscriptionReminders([sub({ cancelDeadline: '2026-11-20' })], '2026-11-09', NOW);
  const pay = p.find((r) => r.kind === 'payment' && r.date === '2026-11-15');
  assert.equal(pay.triggerAt, '2026-11-14T09:00:00+09:00');
  assert.match(pay.body, /클라우드 12,000원/);
  const deadline = p.find((r) => r.kind === 'cancel-deadline');
  assert.equal(deadline.triggerAt, '2026-11-19T09:00:00+09:00');
});

test('결제 알림은 앞으로 3번까지 미리 걸고, 이미 지난 시각은 제외한다', () => {
  const p = plan.planSubscriptionReminders([sub()], '2026-11-09', NOW);
  assert.deepEqual(p.map((r) => r.date), ['2026-11-15', '2026-12-15', '2027-01-15']);
  // 결제일이 내일이면 하루 전 9시는 이미 지났으므로 첫 건은 빠지고 다음 달부터 시작
  const tomorrow = plan.planSubscriptionReminders([sub({ billingAnchorDate: '2026-11-10' })], '2026-11-09', NOW);
  assert.deepEqual(tomorrow.map((r) => r.date), ['2026-12-10', '2027-01-10']);
});

test('같은 입력이면 같은 identifier — 재동기화가 중복 알림을 만들지 않는다', () => {
  const a = plan.planSubscriptionReminders([sub()], '2026-11-09', NOW).map((r) => r.identifier);
  const b = plan.planSubscriptionReminders([sub()], '2026-11-09', NOW).map((r) => r.identifier);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length);
  assert.ok(a.every((id) => id.startsWith(plan.SUBSCRIPTION_REMINDER_ID_PREFIX)));
});

test('기기 알림 총량 상한과 시각 순 정렬', () => {
  const many = Array.from({ length: 30 }, (_, i) => sub({ id: `s${i}`, name: `서비스${i}`, billingAnchorDate: `2026-12-${String((i % 28) + 1).padStart(2, '0')}` }));
  const p = plan.planSubscriptionReminders(many, '2026-11-09', NOW);
  assert.equal(p.length, plan.MAX_SUBSCRIPTION_REMINDERS);
  assert.ok(p.every((r, i) => i === 0 || Date.parse(p[i - 1].triggerAt) <= Date.parse(r.triggerAt)));
});

test('지난 해지기한과 빈 목록은 알림을 만들지 않는다', () => {
  assert.deepEqual(plan.planSubscriptionReminders([], '2026-11-09', NOW), []);
  const p = plan.planSubscriptionReminders([sub({ billingAnchorDate: '2026-12-30', cancelDeadline: '2026-11-01' })], '2026-11-09', NOW);
  assert.equal(p.some((r) => r.kind === 'cancel-deadline'), false);
});

test('구독 알림만 골라낸다 — 일정 알림은 건드리지 않는다', () => {
  const mine = { identifier: `${plan.SUBSCRIPTION_REMINDER_ID_PREFIX}payment.s1.2026-11-15`, content: { data: { owner: plan.SUBSCRIPTION_REMINDER_OWNER } } };
  const schedule = { identifier: 'worklog.reminder.v3.abc', content: { data: { owner: 'worklog.schedule-reminder.v3' } } };
  const spoof = { identifier: `${plan.SUBSCRIPTION_REMINDER_ID_PREFIX}x`, content: { data: { owner: 'other' } } };
  assert.equal(plan.isSubscriptionReminderRequest(mine), true);
  assert.equal(plan.isSubscriptionReminderRequest(schedule), false);
  assert.equal(plan.isSubscriptionReminderRequest(spoof), false);
  assert.equal(plan.isSubscriptionReminderRequest({ identifier: mine.identifier }), false);
});

// ---- store ----
const validRow = (o = {}) => ({
  id: 'a', name: '클라우드', amount_krw: 12000, billing_cycle: 'monthly', scope: 'business',
  billing_anchor_date: '2026-11-15', cancel_deadline: null, last_used_date: null, created_at: '2026-11-01T00:00:00Z', ...o,
});

test('서버 행을 앱 모델로 바꾸되 형식이 틀린 행은 고치지 않고 버린다', () => {
  assert.deepEqual(store.subscriptionFromRow(validRow({ last_used_date: '2026-11-05', cancel_deadline: '2026-12-01' })), {
    expenseKind: 'subscription', variableAmount: false, id: 'a', name: '클라우드', amountKrw: 12000, cycle: 'monthly', scope: 'business', billingAnchorDate: '2026-11-15',
    cancelDeadline: '2026-12-01', lastUsedDate: '2026-11-05', createdAt: '2026-11-01T00:00:00Z', sourceText: null,
  });
  assert.equal(store.subscriptionFromRow(validRow({ source_text: '사업 클라우드 매달 1만원' })).sourceText, '사업 클라우드 매달 1만원');
  assert.equal(store.subscriptionFromRow(validRow({ source_text: '   ' })).sourceText, null);
  assert.equal(store.subscriptionFromRow(validRow({ amount_krw: 0 })), null);
  assert.equal(store.subscriptionFromRow(validRow({ amount_krw: 1.5 })), null);
  assert.equal(store.subscriptionFromRow(validRow({ scope: 'team' })), null);
  assert.equal(store.subscriptionFromRow(validRow({ billing_cycle: 'weekly' })), null);
  assert.equal(store.subscriptionFromRow(validRow({ billing_anchor_date: '2026-02-30' })), null);
  assert.equal(store.subscriptionFromRow(validRow({ name: '  ' })), null);
  assert.equal(store.subscriptionFromRow(null), null);
});

function fakeClient(result) {
  const calls = [];
  const builder = { calls };
  const chain = (name) => (...args) => { calls.push([name, ...args]); return builder; };
  for (const m of ['select', 'insert', 'update', 'eq', 'is', 'order', 'limit']) builder[m] = chain(m);
  builder.single = () => Promise.resolve(result);
  builder.maybeSingle = () => Promise.resolve(result);
  builder.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return { from: (table) => { calls.push(['from', table]); return builder; }, calls };
}

test('목록은 보관되지 않은 구독의 전체 조회를 확인하고 잘못된 행은 성공 처리하지 않는다', async () => {
  const client = fakeClient({ data: [validRow()], count:1, error: null });
  const list = await store.listSubscriptions(client);
  assert.deepEqual(list.map((s) => s.id), ['a']);
  await assert.rejects(store.listSubscriptions(fakeClient({data:[validRow()],count:2,error:null})),/전체 목록/);
  await assert.rejects(store.listSubscriptions(fakeClient({data:[validRow({amount_krw:-1})],count:1,error:null})),/데이터 확인/);
  assert.deepEqual(client.calls.find((c) => c[0] === 'is'), ['is', 'archived_at', null]);
  assert.deepEqual(client.calls[0], ['from', 'subscriptions']);
});

test('추가는 user_id를 보내지 않는다 — 서버 기본값(auth.uid())이 주인을 정한다', async () => {
  const client = fakeClient({ data: validRow(), error: null });
  await store.createSubscription(client, { name: '클라우드', amountKrw: 12000, cycle: 'monthly', scope: 'business', billingAnchorDate: '2026-11-15', cancelDeadline: null });
  const insert = client.calls.find((c) => c[0] === 'insert')[1];
  assert.equal('user_id' in insert, false);
  assert.deepEqual(insert, { name: '클라우드', amount_krw: 12000, billing_cycle: 'monthly', scope: 'business', billing_anchor_date: '2026-11-15', cancel_deadline: null });
});

test('수정/사용기록/보관은 대상 행이 없으면 성공으로 취급하지 않는다', async () => {
  const none = fakeClient({ data: null, error: null });
  await assert.rejects(store.markSubscriptionUsed(none, 'x', '2026-11-09'), /이미 삭제되었거나/);
  await assert.rejects(store.archiveSubscription(fakeClient({ data: null, error: null }), 'x'), /이미 삭제되었거나/);
  const ok = fakeClient({ data: validRow({ last_used_date: '2026-11-09' }), error: null });
  const updated = await store.markSubscriptionUsed(ok, 'a', '2026-11-09');
  assert.equal(updated.lastUsedDate, '2026-11-09');
  assert.deepEqual(ok.calls.find((c) => c[0] === 'update')[1], { last_used_date: '2026-11-09' });
  assert.deepEqual(ok.calls.filter((c) => c[0] === 'is').map((c) => c.slice(1)), [['archived_at', null]]);
  assert.throws(() => store.markSubscriptionUsed(ok, 'a', 'not-a-date'), /날짜/);
});

test('보관은 삭제가 아니라 archived_at 갱신이다', async () => {
  const client = fakeClient({ data: validRow(), error: null });
  await store.archiveSubscription(client, 'a', new Date('2026-11-09T00:00:00Z'));
  assert.deepEqual(client.calls.find((c) => c[0] === 'update')[1], { archived_at: '2026-11-09T00:00:00.000Z' });
  assert.equal(client.calls.some((c) => c[0] === 'delete'), false);
});

test('오류 메시지: 테이블 미준비·권한·일반 오류를 구분하고 내부 문구를 노출하지 않는다', async () => {
  assert.match(store.subscriptionErrorMessage({ code: 'PGRST205', message: "Could not find the table 'public.subscriptions'" }), /준비하는 중/);
  assert.match(store.subscriptionErrorMessage({ code: '42501', message: 'new row violates row-level security policy' }), /로그인/);
  const generic = store.subscriptionErrorMessage({ message: 'connection reset by peer at 10.0.0.1' });
  assert.doesNotMatch(generic, /10\.0\.0\.1/);
  await assert.rejects(store.listSubscriptions(fakeClient({ data: null, error: { code: 'PGRST205', message: 'x' } })), /준비하는 중/);
});

test('원문(source_text)은 새로 만들 때만 보내고, 수정·사용기록에서는 덮어쓰지 않는다', async () => {
  const input = { name: '클라우드', amountKrw: 12000, cycle: 'monthly', scope: 'business', billingAnchorDate: '2026-11-15', cancelDeadline: null, sourceText: '사업 클라우드 매달 1만 2천원 15일' };
  const created = fakeClient({ data: validRow({ source_text: input.sourceText }), error: null });
  const result = await store.createSubscription(created, input);
  assert.equal(created.calls.find((c) => c[0] === 'insert')[1].source_text, input.sourceText);
  assert.equal(result.sourceText, input.sourceText);

  const direct = fakeClient({ data: validRow(), error: null });
  await store.createSubscription(direct, { ...input, sourceText: null });
  assert.equal('source_text' in direct.calls.find((c) => c[0] === 'insert')[1], false, '직접 입력은 원문 칸을 비워 둔다');

  const edited = fakeClient({ data: validRow(), error: null });
  await store.updateSubscription(edited, 'a', input);
  assert.equal('source_text' in edited.calls.find((c) => c[0] === 'update')[1], false, '수정은 처음 입력한 원문을 지우거나 바꾸지 않는다');

  const long = fakeClient({ data: validRow(), error: null });
  await store.createSubscription(long, { ...input, sourceText: '가'.repeat(500) });
  assert.equal(long.calls.find((c) => c[0] === 'insert')[1].source_text.length, 300);
});
