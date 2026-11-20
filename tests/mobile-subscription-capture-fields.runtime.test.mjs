import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { subscriptionReceiptDraft } = await import('../mobile/src/features/subscriptions/subscription-receipt-draft.ts');

const googlePlay = `Google Play
구독이 갱신되어 요금이 청구되었습니다.
주문 날짜: 2026. 11. 16. 오후 6시 49분 49초
상품
가격
YouTube Premium (YouTube) 매월 ₩14,900
자동 갱신되는 정기 결제
합계: 매월 ₩14,900
(VAT ₩1,355 포함)
결제 방법: kakaopay: example@example.invalid
Play 포인트 적립`;

const expected = {
  name: 'YouTube Premium (YouTube)', amountText: '14900', cycle: 'monthly',
  paymentMethod: 'other', paymentName: '카카오페이',
};

test('reads a Google Play renewal without treating the order date as the next payment', () => {
  assert.deepEqual(subscriptionReceiptDraft(googlePlay), expected);
});

test('reads Google Play when OCR separates the columns or drops a label colon', () => {
  const separated = googlePlay
    .replace('가격\nYouTube Premium (YouTube) 매월 ₩14,900\n자동 갱신되는 정기 결제', 'YouTube Premium (\nYouTube)\n자동 갱신되는 정기 결제\n가격\n매 월\n\\14,900')
    .replace('합계: 매월', '합계')
    .replace('결제 방법: ', '결제 방법\n');
  assert.deepEqual(subscriptionReceiptDraft(separated), expected);
});

test('uses the product price when the total includes unreadable text', () => {
  assert.deepEqual(subscriptionReceiptDraft(googlePlay.replace('합계: 매월 ₩14,900', '합계: 읽지 못한 값')), expected);
});

test('leaves the cycle unfilled when the total and product disagree', () => {
  const draft = subscriptionReceiptDraft(googlePlay.replace('합계: 매월', '합계: 매년'));
  assert.equal(draft.cycle, undefined);
  assert.equal(draft.amountText, '14900');
});

test('does not turn a multi-product total into one subscription', () => {
  const draft = subscriptionReceiptDraft(googlePlay.replace('합계:', '다른 서비스 매년 ₩30,000\n합계:'));
  assert.deepEqual(draft, { paymentMethod: 'other', paymentName: '카카오페이' });
});

test('reads common labels on another Korean receipt with a payment timestamp', () => {
  const kakao = '카카오페이\n상품명\nCloud Basic\n결제금액  8,500원\n결제수단 카카오페이머니\n잔액충전 10,000원\n결제일시: 2026. 11. 14.';
  assert.deepEqual(subscriptionReceiptDraft(kakao), {
    name: 'Cloud Basic', amountText: '8500', paymentMethod: 'other', paymentName: '카카오페이머니',
  });
});

test('reads an English USD receipt with an explicit next billing date', () => {
  const receipt = 'Service name: Cloud Storage\nAmount charged: USD 12.99\nBilling cycle: Annual\nPayment method: credit card •••• 1234\nNext billing date: 2027-11-16';
  assert.deepEqual(subscriptionReceiptDraft(receipt), {
    name: 'Cloud Storage', amountText: '12.99', currency: 'USD', cycle: 'yearly',
    billingAnchorDate: '2027-11-16', paymentMethod: 'card',
  });
});

test('only fills fields supported by a receipt with unknown or conflicting values', () => {
  assert.equal(subscriptionReceiptDraft('샘플 영수증\n14,900원\n카카오페이\n2026-11-16'), null);
  assert.deepEqual(subscriptionReceiptDraft('상품명:\n결제금액 14,900원\n결제금액 8,500원\n청구 주기: 매월'), { cycle: 'monthly' });
});
