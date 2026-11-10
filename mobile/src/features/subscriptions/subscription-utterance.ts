import {
  isValidDateKey,
  nextPaymentDate,
  parseDateKey,
  type BillingCycle,
  type SubscriptionDraft,
  type SubscriptionScope,
} from './subscription-model';

/**
 * 말(또는 키보드 음성입력)로 한 줄 입력한 문장을 구독 입력 초안으로 바꾼다.
 * 규칙 기반이며 AI를 쓰지 않는다. 원칙:
 *  - 금액·결제일·주기는 문장에서 분명히 읽힐 때만 채우고, 애매하면 비워서 사용자가 확인하게 한다.
 *  - 서비스 이름은 고치지 않는다. 이미 등록한 이름과 비슷하면 '후보'로만 보여준다.
 *  - 원문은 그대로 보존한다(parse.rawText).
 */
export type UtteranceField = 'scope' | 'name' | 'amount' | 'cycle' | 'date';

export type UtteranceParse = {
  rawText: string;
  scope: SubscriptionScope | null;
  cycle: BillingCycle | null;
  amountKrw: number | null;
  billingAnchorDate: string | null;
  name: string;
  /** 문장에서 읽지 못했거나 애매해서 사용자가 직접 정해야 하는 항목. */
  missing: UtteranceField[];
  nameCandidates: string[];
  warnings: string[];
};

const MAX_AMOUNT_KRW = 100_000_000;
const MAX_RAW_LENGTH = 300;

const SCOPE_PATTERN = /(^|\s)(사업용|사업|개인용|개인)(?=\s|$)/g;
const YEARLY_PATTERN = /(일\s*년에|1\s*년에|한\s*해에|매\s*년|연간|연\s*결제|연\s*구독|해마다|년\s*마다)/g;
const MONTHLY_PATTERN = /(한\s*달에|매\s*달|매\s*월|월\s*마다|달\s*마다|월\s*정액)/g;
/** '월 1만 5천원', '연 12만원'처럼 금액 바로 앞에 붙은 한 글자 주기. 3월 같은 숫자 뒤 '월'은 해당 없음. */
const SHORT_CYCLE_PATTERN = /(^|\s)(월|연)(?=\s*(?:[0-9]|[일이삼사오육칠팔구십백천만억]))/g;
const UNSUPPORTED_CYCLE_PATTERN = /\d+\s*개월/g;
const END_OF_MONTH_PATTERN = /말일/g;
const FILLER_WORDS = new Set(['구독', '구독료', '자동결제', '정기결제', '정기', '결제', '요금', '이용료','추가', '등록', '해줘', '해주세요', '해', '합니다', '입니다', '이야', '인데', '로', '으로', '에', '은', '는', '이', '가', '을', '를', '부터', '마다', '씩']);

const DIGIT: Record<string, number> = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
const SMALL_UNIT: Record<string, number> = { 십: 10, 백: 100, 천: 1000 };
const BIG_UNIT: Record<string, number> = { 만: 10_000, 억: 100_000_000 };

/** '1만 2천', '십이만', '12,000', '만' 같은 한국어 금액 표현(원 앞부분)을 정수로. 읽을 수 없으면 null. */
export function parseKoreanWon(expression: string): number | null {
  const text = expression.replace(/[,\s]/g, '');
  if (!text || /[^0-9일이삼사오육칠팔구십백천만억]/.test(text)) return null;
  let total = 0;
  let section = 0;
  let num = 0;
  let sawAny = false;
  for (let i = 0; i < text.length;) {
    const ch = text[i];
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < text.length && /[0-9]/.test(text[j])) j += 1;
      num = Number(text.slice(i, j));
      sawAny = true;
      i = j;
    } else if (ch in DIGIT) {
      num = DIGIT[ch];
      sawAny = true;
      i += 1;
    } else if (ch in SMALL_UNIT) {
      section += (num || 1) * SMALL_UNIT[ch];
      num = 0;
      sawAny = true;
      i += 1;
    } else {
      total += (section + num || 1) * BIG_UNIT[ch];
      section = 0;
      num = 0;
      sawAny = true;
      i += 1;
    }
  }
  const value = total + section + num;
  return sawAny && Number.isSafeInteger(value) ? value : null;
}

function collapse(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function allMatches(text: string, pattern: RegExp) {
  return [...text.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))];
}

function dateKey(y: number, m: number, d: number) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function levenshtein(a: string, b: string) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return prev[b.length];
}

const normalizeName = (name: string) => name.replace(/\s+/g, '').toLowerCase();

/** 이미 등록한 이름 중 비슷한 것. 같은 이름은 후보가 아니다. 새 이름은 고치지 않는다. */
export function suggestNameCandidates(name: string, existingNames: readonly string[], limit = 3) {
  const target = normalizeName(name);
  if (target.length < 2) return [];
  const seen = new Set<string>();
  const scored: { name: string; score: number }[] = [];
  for (const existing of existingNames) {
    const candidate = normalizeName(existing);
    if (!candidate || candidate === target || seen.has(candidate)) continue;
    seen.add(candidate);
    const near = candidate.includes(target) || target.includes(candidate);
    const distance = levenshtein(target, candidate);
    const close = distance <= Math.max(1, Math.floor(Math.min(target.length, candidate.length) / 4));
    if (near || close) scored.push({ name: existing, score: near ? 0 : distance });
  }
  return scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name, 'ko')).slice(0, limit).map((s) => s.name);
}

export function parseSubscriptionUtterance(input: string, todayKey: string, existingNames: readonly string[] = []): UtteranceParse {
  const rawText = String(input || '').trim().slice(0, MAX_RAW_LENGTH);
  const warnings: string[] = [];
  let rest = ` ${rawText} `;

  // 1) 구분
  let scope: SubscriptionScope | null = null;
  const scopes = new Set(allMatches(rest, SCOPE_PATTERN).map((m) => (m[2].startsWith('사업') ? 'business' : 'personal')));
  if (scopes.size === 1) scope = [...scopes][0] as SubscriptionScope;
  else if (scopes.size > 1) warnings.push('‘사업’과 ‘개인’이 모두 들어 있어요. 구분을 직접 골라주세요.');
  rest = rest.replace(SCOPE_PATTERN, ' ');

  // 2) 주기 — '일 년에'의 '일'이 날짜로 읽히지 않도록 날짜보다 먼저 지운다.
  const shortCycles = new Set(allMatches(rest, SHORT_CYCLE_PATTERN).map((m) => m[2]));
  const yearly = allMatches(rest, YEARLY_PATTERN).length > 0 || shortCycles.has('연');
  const monthly = allMatches(rest, MONTHLY_PATTERN).length > 0 || shortCycles.has('월');
  let cycle: BillingCycle | null = null;
  if (yearly && monthly) warnings.push('‘매달’과 ‘매년’이 모두 들어 있어요. 결제 주기를 직접 골라주세요.');
  else if (yearly) cycle = 'yearly';
  else if (monthly) cycle = 'monthly';
  rest = rest.replace(YEARLY_PATTERN, ' ').replace(MONTHLY_PATTERN, ' ').replace(SHORT_CYCLE_PATTERN, ' ');
  // 아직 지원하지 않는 표현은 조용히 무시하지 않고 알려준다(이름에 섞이지도 않게 지운다).
  if (allMatches(rest, UNSUPPORTED_CYCLE_PATTERN).length > 0) warnings.push('‘N개월’ 주기는 아직 지원하지 않아요. 매월 또는 매년 중에서 골라주세요.');
  if (allMatches(rest, END_OF_MONTH_PATTERN).length > 0) warnings.push('‘말일’ 결제는 아직 지원하지 않아요. 결제일을 직접 골라주세요.');
  rest = rest.replace(UNSUPPORTED_CYCLE_PATTERN, ' ').replace(END_OF_MONTH_PATTERN, ' ');

  // 3) 결제일 — 분명한 숫자 표현만. '내일' 같은 상대 표현은 추정하지 않는다.
  let billingAnchorDate: string | null = null;
  const dateCandidates: { key: string | null; pattern: RegExp }[] = [];
  const year = Number(todayKey.slice(0, 4));
  const datePatterns: { pattern: RegExp; build: (m: RegExpMatchArray) => string | null }[] = [
    { pattern: /(\d{4})-(\d{1,2})-(\d{1,2})/g, build: (m) => dateKey(Number(m[1]), Number(m[2]), Number(m[3])) },
    { pattern: /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g, build: (m) => dateKey(Number(m[1]), Number(m[2]), Number(m[3])) },
    {
      pattern: /(\d{1,2})\s*월\s*(\d{1,2})\s*일/g,
      build: (m) => {
        const key = dateKey(year, Number(m[1]), Number(m[2]));
        return isValidDateKey(key) ? nextPaymentDate(key, cycle === 'monthly' ? 'monthly' : 'yearly', todayKey) : key;
      },
    },
    {
      pattern: /(\d{1,2})\s*일/g,
      build: (m) => {
        const day = Number(m[1]);
        if (day < 1 || day > 31) return dateKey(year, 1, 99);
        if (cycle === 'yearly') return null;
        const monthLength = new Date(Date.UTC(year, Number(todayKey.slice(5, 7)), 0)).getUTCDate();
        const anchor = dateKey(year, Number(todayKey.slice(5, 7)), Math.min(day, monthLength));
        return nextPaymentDate(anchor, 'monthly', todayKey);
      },
    },
  ];
  for (const { pattern, build } of datePatterns) {
    for (const match of allMatches(rest, pattern)) dateCandidates.push({ key: build(match), pattern });
    const before = rest;
    rest = rest.replace(pattern, ' ');
    if (before !== rest) {
      // 더 구체적인 표현이 하나 읽혔으면 덜 구체적인 패턴은 같은 문장을 다시 읽지 않는다(이미 지워졌다).
    }
  }
  const keys = dateCandidates.map((c) => c.key);
  if (keys.length === 1) {
    if (keys[0] && isValidDateKey(keys[0]) && parseDateKey(keys[0])) billingAnchorDate = keys[0];
    else if (keys[0]) warnings.push('결제일이 달력에 없는 날짜예요. 직접 골라주세요.');
  } else if (keys.length > 1) warnings.push('날짜가 여러 개 들어 있어요. 결제일을 직접 골라주세요.');

  // 4) 금액 — '원'으로 끝나는 숫자 표현. 소수·여러 개면 고르지 않는다.
  let amountKrw: number | null = null;
  const AMOUNT_PATTERN = /([0-9][0-9,.]*[0-9일이삼사오육칠팔구십백천만억\s]*|[일이삼사오육칠팔구십백천만억][0-9일이삼사오육칠팔구십백천만억,\s]*)원/g;
  const amounts = allMatches(rest, AMOUNT_PATTERN);
  if (amounts.length === 1) {
    const expression = amounts[0][1];
    const value = /\./.test(expression) ? null : parseKoreanWon(expression);
    if (value !== null && value > 0 && value <= MAX_AMOUNT_KRW) amountKrw = value;
    else warnings.push('금액을 정확히 읽지 못했어요. 직접 입력해주세요.');
  } else if (amounts.length > 1) warnings.push('금액이 여러 개 들어 있어요. 직접 입력해주세요.');
  rest = rest.replace(AMOUNT_PATTERN, ' ');

  // 5) 이름 — 남은 말에서 군더더기 단어만 걷어낸다. 철자는 고치지 않는다.
  const name = collapse(collapse(rest).split(' ').filter((word) => word && !FILLER_WORDS.has(word)).join(' '));

  const missing: UtteranceField[] = [];
  if (!scope) missing.push('scope');
  if (!name) missing.push('name');
  if (amountKrw === null) missing.push('amount');
  if (!cycle) missing.push('cycle');
  if (!billingAnchorDate) missing.push('date');

  return {
    rawText,
    scope,
    cycle,
    amountKrw,
    billingAnchorDate,
    name,
    missing,
    nameCandidates: suggestNameCandidates(name, existingNames),
    warnings,
  };
}

/** 확인 화면에 미리 채울 초안. 못 읽은 값은 비워 두어 저장 전에 사용자가 직접 정하게 한다. */
export function draftFromUtterance(parse: UtteranceParse, defaultScope: SubscriptionScope): SubscriptionDraft {
  return {
    name: parse.name,
    amountText: parse.amountKrw === null ? '' : String(parse.amountKrw),
    cycle: parse.cycle || 'monthly',
    scope: parse.scope || defaultScope,
    billingAnchorDate: parse.billingAnchorDate || '',
    cancelDeadline: '',
  };
}

export const UTTERANCE_FIELD_LABEL: Record<UtteranceField, string> = {
  scope: '사업/개인 구분',
  name: '서비스 이름',
  amount: '금액',
  cycle: '결제 주기',
  date: '결제일',
};
