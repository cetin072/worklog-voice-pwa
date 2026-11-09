import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const u = await import('../mobile/src/features/subscriptions/subscription-utterance.ts');
const TODAY = '2026-11-09';

test('한국어 금액 표현을 정수로 읽는다', () => {
  const cases = { '12,000': 12000, '12000': 12000, '1만 2천': 12000, '1만2천': 12000, '만': 10000, '만 이천': 12000, '십이만': 120000, '이만 오천': 25000, '천': 1000, '9천9백': 9900, '삼천구백': 3900, '일만': 10000, '1억': 100000000, '5': 5 };
  for (const [text, expected] of Object.entries(cases)) assert.equal(u.parseKoreanWon(text), expected, text);
  for (const bad of ['', '원', 'abc', '1.5만', '만원원']) assert.equal(u.parseKoreanWon(bad), null, bad);
});

test('한 문장에서 구분·이름·금액·주기·결제일을 읽는다', () => {
  const p = u.parseSubscriptionUtterance('사업 클라우드 저장공간 구독 매달 1만 2천원 15일 결제', TODAY);
  assert.equal(p.scope, 'business');
  assert.equal(p.name, '클라우드 저장공간');
  assert.equal(p.amountKrw, 12000);
  assert.equal(p.cycle, 'monthly');
  assert.equal(p.billingAnchorDate, '2026-11-15');
  assert.deepEqual(p.missing, []);
  assert.deepEqual(p.warnings, []);
  assert.equal(p.rawText, '사업 클라우드 저장공간 구독 매달 1만 2천원 15일 결제');
});

test('연 결제: "일 년에"의 일이 날짜로 읽히지 않고, 월·일 날짜는 다음 해당일로', () => {
  const p = u.parseSubscriptionUtterance('개인 영상 서비스 일 년에 십이만원 3월 10일', TODAY);
  assert.equal(p.scope, 'personal');
  assert.equal(p.cycle, 'yearly');
  assert.equal(p.amountKrw, 120000);
  assert.equal(p.billingAnchorDate, '2027-03-10');
  assert.equal(p.name, '영상 서비스');
  assert.deepEqual(p.missing, []);
});

test('숫자 표기·ISO 날짜·연월일 표현', () => {
  assert.equal(u.parseSubscriptionUtterance('사업 도메인 매년 22,000원 2026-12-01', TODAY).billingAnchorDate, '2026-12-01');
  const full = u.parseSubscriptionUtterance('개인 보험 매월 9900원 2026년 12월 5일', TODAY);
  assert.equal(full.billingAnchorDate, '2026-12-05');
  assert.equal(full.amountKrw, 9900);
  assert.equal(full.name, '보험');
});

test('말하지 않은 값은 추측하지 않고 확인 필요로 남긴다', () => {
  const p = u.parseSubscriptionUtterance('넷플릭스 구독', TODAY);
  assert.equal(p.name, '넷플릭스');
  assert.equal(p.amountKrw, null);
  assert.equal(p.cycle, null);
  assert.equal(p.billingAnchorDate, null);
  assert.equal(p.scope, null);
  assert.deepEqual(p.missing.sort(), ['amount', 'cycle', 'date', 'scope']);
  const draft = u.draftFromUtterance(p, 'personal');
  assert.equal(draft.amountText, '');
  assert.equal(draft.billingAnchorDate, '');
  assert.equal(draft.scope, 'personal', '구분 기본값은 마지막에 쓴 구분');
});

test('애매하거나 충돌하는 값은 고르지 않고 경고한다', () => {
  const twoAmounts = u.parseSubscriptionUtterance('사업 클라우드 매달 1만원 2만원', TODAY);
  assert.equal(twoAmounts.amountKrw, null);
  assert.match(twoAmounts.warnings.join(' '), /금액이 여러 개/);
  const twoScopes = u.parseSubscriptionUtterance('사업 개인 클라우드 1만원', TODAY);
  assert.equal(twoScopes.scope, null);
  assert.match(twoScopes.warnings.join(' '), /사업.*개인/);
  const twoCycles = u.parseSubscriptionUtterance('클라우드 매달 매년 1만원', TODAY);
  assert.equal(twoCycles.cycle, null);
  const twoDates = u.parseSubscriptionUtterance('클라우드 매달 1만원 5일 20일', TODAY);
  assert.equal(twoDates.billingAnchorDate, null);
  assert.match(twoDates.warnings.join(' '), /날짜가 여러 개/);
  const decimal = u.parseSubscriptionUtterance('클라우드 매달 1.5만원', TODAY);
  assert.equal(decimal.amountKrw, null);
  assert.match(decimal.warnings.join(' '), /정확히 읽지 못했어요/);
});

test('달력에 없는 날짜와 상대 표현은 날짜로 추정하지 않는다', () => {
  const feb30 = u.parseSubscriptionUtterance('클라우드 매년 1만원 2월 30일', TODAY);
  assert.equal(feb30.billingAnchorDate, null);
  assert.match(feb30.warnings.join(' '), /달력에 없는/);
  const relative = u.parseSubscriptionUtterance('클라우드 매달 1만원 내일 결제', TODAY);
  assert.equal(relative.billingAnchorDate, null);
  assert.ok(relative.missing.includes('date'));
});

test('연 결제에 일(日)만 말하면 어느 달인지 알 수 없어 비워 둔다', () => {
  const p = u.parseSubscriptionUtterance('클라우드 매년 12만원 10일', TODAY);
  assert.equal(p.billingAnchorDate, null);
  assert.ok(p.missing.includes('date'));
});

test('이미 지난 일(日)은 다음 달로 넘기고, 31일은 말일로 보정한다', () => {
  assert.equal(u.parseSubscriptionUtterance('클라우드 매달 1만원 5일', TODAY).billingAnchorDate, '2026-12-05');
  assert.equal(u.parseSubscriptionUtterance('클라우드 매달 1만원 9일', TODAY).billingAnchorDate, '2026-11-09');
  assert.equal(u.parseSubscriptionUtterance('클라우드 매달 1만원 31일', TODAY).billingAnchorDate, '2026-11-30');
});

test('이름은 고치지 않는다 — 원문 철자 그대로, 공백만 정리', () => {
  const p = u.parseSubscriptionUtterance('  사업    넷플릭   구독   1만원 매달 5일 ', TODAY);
  assert.equal(p.name, '넷플릭');
  assert.equal(u.parseSubscriptionUtterance('개인정보 보호 서비스 매달 3000원 5일', TODAY).name, '개인정보 보호 서비스', '‘개인’이 이름의 일부면 구분으로 읽지 않는다');
});

test('등록된 이름과 비슷하면 후보만 제시하고, 같은 이름·무관한 이름은 제시하지 않는다', () => {
  const existing = ['넷플릭스', '클라우드 저장공간', '음악 스트리밍'];
  assert.deepEqual(u.suggestNameCandidates('넷플릭', existing), ['넷플릭스']);
  assert.deepEqual(u.suggestNameCandidates('넷플렉스', existing), ['넷플릭스']);
  assert.deepEqual(u.suggestNameCandidates('클라우드저장공간', existing), [], '띄어쓰기만 다른 같은 이름');
  assert.deepEqual(u.suggestNameCandidates('넷플릭스', existing), [], '완전히 같으면 후보가 아님');
  assert.deepEqual(u.suggestNameCandidates('완전히다른이름', existing), []);
  assert.deepEqual(u.suggestNameCandidates('가', existing), [], '너무 짧은 이름은 후보를 만들지 않음');
  const p = u.parseSubscriptionUtterance('개인 넷플릭 매달 9500원 3일', TODAY, existing);
  assert.deepEqual(p.nameCandidates, ['넷플릭스']);
  assert.equal(p.name, '넷플릭', '후보가 있어도 이름 자체는 바꾸지 않는다');
});

test('빈 입력과 너무 긴 입력', () => {
  const empty = u.parseSubscriptionUtterance('   ', TODAY);
  assert.deepEqual(empty.missing.sort(), ['amount', 'cycle', 'date', 'name', 'scope']);
  assert.equal(u.parseSubscriptionUtterance('가'.repeat(1000), TODAY).rawText.length, 300);
});

test('"월 1만 5천원"·"연 12만원"처럼 금액 앞에 붙은 주기를 읽고 이름에 섞지 않는다', () => {
  const monthly = u.parseSubscriptionUtterance('사업 슬랙 월 1만5천원 20일', TODAY);
  assert.deepEqual([monthly.name, monthly.cycle, monthly.amountKrw, monthly.billingAnchorDate], ['슬랙', 'monthly', 15000, '2026-11-20']);
  const yearly = u.parseSubscriptionUtterance('개인 음악 연 12만원 3월 1일', TODAY);
  assert.deepEqual([yearly.name, yearly.cycle, yearly.amountKrw, yearly.billingAnchorDate], ['음악', 'yearly', 120000, '2027-03-01']);
  // 숫자 뒤의 '월'(3월)은 주기가 아니다
  assert.equal(u.parseSubscriptionUtterance('음악 3월 1일 12만원', TODAY).cycle, null);
});

test('지원하지 않는 표현(N개월, 말일)은 무시하지 않고 경고하며 이름에도 섞이지 않는다', () => {
  const quarter = u.parseSubscriptionUtterance('개인 헬스장 3개월 15만원 5일', TODAY);
  assert.equal(quarter.name, '헬스장');
  assert.equal(quarter.cycle, null);
  assert.match(quarter.warnings.join(' '), /개월/);
  const eom = u.parseSubscriptionUtterance('사업 호스팅 구독료 9천900원 매달 말일', TODAY);
  assert.equal(eom.name, '호스팅');
  assert.equal(eom.billingAnchorDate, null);
  assert.match(eom.warnings.join(' '), /말일/);
});

test('같은 파서를 연속 호출해도 이전 호출의 상태가 남지 않는다', () => {
  for (let i = 0; i < 3; i += 1) {
    const p = u.parseSubscriptionUtterance('사업 호스팅 매달 9천900원 말일 3개월', TODAY);
    assert.equal(p.warnings.length, 2, `call ${i}`);
  }
});
