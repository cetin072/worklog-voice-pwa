import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const m = await import('../mobile/src/features/subscriptions/subscription-model.ts');

const sub = (overrides = {}) => ({
  id: 's1', name: '클라우드', amountKrw: 12000, cycle: 'monthly', scope: 'business',
  billingAnchorDate: '2026-11-15', cancelDeadline: null, lastUsedDate: null, createdAt: '2026-11-01T00:00:00Z', ...overrides,
});

test('연 결제는 월 환산해 같은 기준으로 합산한다', () => {
  assert.equal(m.monthlyAmountKrw(sub({ cycle: 'yearly', amountKrw: 120000 })), 10000);
  const summary = m.summarizeSubscriptions([
    sub({ amountKrw: 10000, scope: 'business' }),
    sub({ id: 's2', amountKrw: 120000, cycle: 'yearly', scope: 'personal' }),
  ]);
  assert.equal(summary.count, 2);
  assert.equal(summary.monthlyTotalKrw, 20000);
  assert.equal(summary.yearlyTotalKrw, 240000);
  assert.deepEqual(summary.byScope, { business: { count: 1, monthlyTotalKrw: 10000 }, personal: { count: 1, monthlyTotalKrw: 10000 } });
});

test('사업/개인 합계는 전체 합계와 어긋나지 않는다(반올림 누적 방지)', () => {
  const subs = [sub({ id: 'a', amountKrw: 100000, cycle: 'yearly', scope: 'business' }), sub({ id: 'b', amountKrw: 100000, cycle: 'yearly', scope: 'personal' })];
  const s = m.summarizeSubscriptions(subs);
  assert.equal(s.yearlyTotalKrw, 200000);
  assert.equal(s.monthlyTotalKrw, Math.round(200000 / 12));
});

test('빈 목록과 범위 필터', () => {
  assert.deepEqual(m.summarizeSubscriptions([]).byScope.business, { count: 0, monthlyTotalKrw: 0 });
  const subs = [sub(), sub({ id: 's2', scope: 'personal' })];
  assert.equal(m.filterByScope(subs, 'all').length, 2);
  assert.deepEqual(m.filterByScope(subs, 'personal').map((s) => s.id), ['s2']);
});

test('다음 결제일: 기준일이 미래면 그대로, 지났으면 자동으로 앞으로 넘어간다', () => {
  assert.equal(m.nextPaymentDate('2026-12-01', 'monthly', '2026-11-09'), '2026-12-01');
  assert.equal(m.nextPaymentDate('2026-11-09', 'monthly', '2026-11-09'), '2026-11-09');
  assert.equal(m.nextPaymentDate('2026-01-15', 'monthly', '2026-11-09'), '2026-11-15');
  assert.equal(m.nextPaymentDate('2026-01-05', 'monthly', '2026-11-09'), '2026-12-05');
  assert.equal(m.nextPaymentDate('2024-03-10', 'yearly', '2026-11-09'), '2027-03-10');
  assert.equal(m.nextPaymentDate('2024-12-20', 'yearly', '2026-11-09'), '2026-12-20');
});

test('다음 결제일: 31일 기준은 짧은 달에 말일로 맞추되 기준일은 유지된다', () => {
  assert.equal(m.nextPaymentDate('2026-01-31', 'monthly', '2026-02-10'), '2026-02-28');
  assert.equal(m.nextPaymentDate('2026-01-31', 'monthly', '2026-03-01'), '2026-03-31');
  assert.equal(m.nextPaymentDate('2024-01-31', 'monthly', '2028-02-10'), '2028-02-29');
  assert.equal(m.nextPaymentDate('2024-02-29', 'yearly', '2025-03-01'), '2026-02-28');
  assert.equal(m.nextPaymentDate('2024-02-29', 'yearly', '2027-03-01'), '2028-02-29');
});

test('다음 결제일: 연도 경계와 아주 오래된 기준일', () => {
  assert.equal(m.nextPaymentDate('2025-12-31', 'monthly', '2026-01-01'), '2026-01-31');
  assert.equal(m.nextPaymentDate('2015-06-15', 'monthly', '2026-11-09'), '2026-11-15');
  assert.equal(m.nextPaymentDate('2015-06-15', 'yearly', '2026-11-09'), '2027-06-15');
});

test('이번 주 결제와 해지기한 임박 항목을 날짜 순으로 뽑는다', () => {
  const today = '2026-11-09';
  const subs = [
    sub({ id: 'soon', billingAnchorDate: '2026-11-12' }),
    sub({ id: 'far', billingAnchorDate: '2026-11-30' }),
    sub({ id: 'deadline', billingAnchorDate: '2026-11-30', cancelDeadline: '2026-11-10' }),
    sub({ id: 'past-deadline', billingAnchorDate: '2026-11-30', cancelDeadline: '2026-11-01' }),
  ];
  const items = m.urgentItems(subs, today);
  assert.deepEqual(items.map((i) => [i.subscription.id, i.kind, i.daysUntil]), [['deadline', 'cancel-deadline', 1], ['soon', 'payment', 3]]);
});

test('해지 후보: 금액이 크고 오래 안 쓴 구독만, 구분과 무관', () => {
  const today = '2026-11-09';
  assert.equal(m.isCancelCandidate(sub({ lastUsedDate: '2026-09-01' }), today), true);
  assert.equal(m.isCancelCandidate(sub({ lastUsedDate: '2026-09-01', scope: 'personal' }), today), true);
  assert.equal(m.isCancelCandidate(sub({ lastUsedDate: '2026-11-01' }), today), false, '최근에 씀');
  assert.equal(m.isCancelCandidate(sub({ lastUsedDate: '2026-09-01', amountKrw: 3000 }), today), false, '금액이 작음');
  assert.equal(m.isCancelCandidate(sub({ lastUsedDate: '2026-10-11' }), today), false, '29일 경과');
  assert.equal(m.isCancelCandidate(sub({ lastUsedDate: '2026-10-10' }), today), true, '정확히 30일 경과부터 후보');
  assert.equal(m.isCancelCandidate(sub({ lastUsedDate: '2026-10-10', createdAt: null }), today), true, '사용일이 있으면 등록일은 필요 없음');
});

test('한 번도 안 쓴 구독은 등록일부터 센다. 기준일이 없으면 후보로 단정하지 않는다', () => {
  const today = '2026-11-09';
  assert.equal(m.daysSinceUse(sub({ createdAt: '2026-09-01T00:00:00Z' }), today), 69);
  assert.equal(m.isCancelCandidate(sub({ createdAt: '2026-09-01T00:00:00Z' }), today), true);
  assert.equal(m.isCancelCandidate(sub({ createdAt: '2026-11-01T00:00:00Z' }), today), false);
  assert.equal(m.daysSinceUse(sub({ createdAt: null }), today), null);
  assert.equal(m.isCancelCandidate(sub({ createdAt: null }), today), false);
});

test('서울 날짜 변환: UTC 자정 직전/직후', () => {
  assert.equal(m.seoulDateKeyFromIso('2026-11-08T15:30:00Z'), '2026-11-09');
  assert.equal(m.seoulDateKeyFromIso('2026-11-08T14:59:00Z'), '2026-11-08');
  assert.equal(m.seoulDateKeyFromIso('nope'), null);
});

test('기본 정렬은 월 환산 금액 큰 순', () => {
  const sorted = m.sortByMonthlyAmountDesc([
    sub({ id: 'a', name: 'A', amountKrw: 5000 }),
    sub({ id: 'b', name: 'B', amountKrw: 240000, cycle: 'yearly' }),
    sub({ id: 'c', name: 'C', amountKrw: 15000 }),
  ]);
  assert.deepEqual(sorted.map((s) => s.id), ['b', 'c', 'a']);
});

test('금액 표시와 입력 파싱', () => {
  assert.equal(m.formatWon(1234567), '1,234,567원');
  assert.equal(m.formatWon(0), '0원');
  assert.equal(m.parseAmountInput('12,000원'), 12000);
  assert.equal(m.parseAmountInput(' 9900 '), 9900);
  assert.equal(m.parseAmountInput('만원'), null);
  assert.equal(m.parseAmountInput('1.5'), null);
  assert.equal(m.parseAmountInput(''), null);
});

test('입력 검증: 금액·날짜는 임의로 고치지 않고 오류로 돌려준다', () => {
  const draft = { name: ' 클라우드 ', amountText: '12,000', cycle: 'monthly', scope: 'business', billingAnchorDate: '2026-11-15', cancelDeadline: '' };
  const ok = m.validateSubscriptionDraft(draft);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { name: '클라우드', amountKrw: 12000, cycle: 'monthly', scope: 'business', billingAnchorDate: '2026-11-15', cancelDeadline: null });

  const bad = m.validateSubscriptionDraft({ ...draft, name: '', amountText: '0', billingAnchorDate: '2026-02-30', cancelDeadline: '내일' });
  assert.equal(bad.ok, false);
  assert.deepEqual(Object.keys(bad.errors).sort(), ['amount', 'billingAnchorDate', 'cancelDeadline', 'name']);
  assert.equal(m.validateSubscriptionDraft({ ...draft, amountText: '999999999' }).ok, false);
  assert.equal(m.validateSubscriptionDraft({ ...draft, name: 'a'.repeat(61) }).ok, false);
});

test('USD keeps cents and has independent month and year totals', () => {
  const usd = sub({ amountKrw: undefined, amountUsdCents: 1999 });
  const annual = sub({ amountKrw: undefined, amountUsdCents: 12000, cycle: 'yearly', billingAnchorDate: '2026-12-15' });
  const items = [sub({ amountKrw: 8500 }), usd, annual];
  assert.equal(m.parseUsdCents('$19.99'), 1999);
  assert.equal(m.parseUsdCents('19.999'), null);
  assert.equal(m.parseUsdCents('1,99'), null);
  assert.equal(m.formatSubscriptionAmount(usd), '$19.99');
  assert.equal(m.expectedExpenseForMonth(items, '2026-12-01'), 8500);
  assert.equal(m.expectedExpenseForMonth(items, '2026-12-01', 'USD'), 13999);
  const summary = m.summarizeSubscriptions(items);
  assert.equal(summary.monthlyTotalKrw, 8500);
  assert.equal(summary.monthlyTotalUsdCents, 2999);
  assert.equal(summary.yearlyTotalUsdCents, 35988);
});

const { subscriptionReceiptDraft } = await import('../mobile/src/features/subscriptions/subscription-receipt-draft.ts');

test('a receipt uses the charge and provider, leaving renewal fields for confirmation', () => {
  const draft = subscriptionReceiptDraft([
    '- 구매처 : Google', '- 상품명 : Example Subscription', '- 결제일시 : 2026. 11. 14. 12:37',
    '- 결제금액 : 8,500원', '- 결제수단 : 카카오페이머니', '- 잔액충전 : 10,000원',
    '- 충전계좌 : 은행***1234', '- 가맹점 주문번호 : example-id',
  ].join('\n'));
  assert.deepEqual(draft, { name: 'Example Subscription', amountText: '8500', paymentMethod: 'other', paymentName: '카카오페이머니' });
  assert.equal(m.validateSubscriptionDraft({ scope: 'personal', cycle: '', billingAnchorDate: '', cancelDeadline: '', ...draft }).ok, false);
});

test('an explicit USD renewal is prefilled and conflicting or unlabelled amounts stay blank', () => {
  assert.deepEqual(subscriptionReceiptDraft('상품명: Cloud\n결제금액: USD 19.99\n결제 주기: monthly\n갱신일: 2026. 12. 14.'), {
    name: 'Cloud', currency: 'USD', amountText: '19.99', cycle: 'monthly', billingAnchorDate: '2026-12-14',
  });
  assert.equal(subscriptionReceiptDraft('결제금액:\n결제금액: 8500\n잔액충전: 10000원'), null);
  assert.equal(subscriptionReceiptDraft('결제금액: 8,500원\n결제금액: $19.99'), null);
});

test('Google Play receipt table reads wrapped product, monthly grand total and KakaoPay', () => {
  const text = [
    'Google Play', '감사합니다.', '주문 날짜: 2026. 8. 18.',
    '내 계정: sample@example.test', '상품', '가격',
    'Claude Pro Subscription (Claude', 'by Anthropic)', '매월', '₩30,000',
    '자동 갱신되는 정기 결제', '합계: 매월 ₩30,000', '(VAT ₩2,727 포함)',
    '결제 방법:', 'kakaopay: sample@example.test', 'Play 포인트 적립',
  ].join('\n');
  const expected = { name: 'Claude Pro Subscription (Claude by Anthropic)', amountText: '30000',
    cycle: 'monthly', paymentMethod: 'other', paymentName: '카카오페이' };
  assert.deepEqual(subscriptionReceiptDraft(text), expected);
  assert.deepEqual(subscriptionReceiptDraft(text.replace('상품\n가격', '상품 가격').replace('합계: 매월', '합계:\n매월')), expected);
  const noisy = text.replace('상품\n가격', '상품       인식오류')
    .replace('Claude\nby Anthropic)\n매월\n₩30,000', 'Claude       매월\nby Anthropic)      430,000')
    .replace('합계: 매월 ₩30,000', '합계: 매월 \\30,000');
  assert.deepEqual(subscriptionReceiptDraft(noisy), expected);
  const conflicting = subscriptionReceiptDraft(text + '\n합계: 매월 ₩40,000');
  assert.equal(conflicting.amountText, undefined);
  assert.equal(conflicting.billingAnchorDate, undefined);
  assert.equal(subscriptionReceiptDraft('Google Play\nPlay 포인트\n합계: ₩30,000'), null);
});
