/**
 * 내 관리 · 구독/정기결제 도메인 로직 (순수 함수 — 네이티브/네트워크/저장소 의존 없음).
 *
 * 날짜는 모두 서울 기준 'YYYY-MM-DD' 문자열로 다룬다. 시각이 필요한 곳(알림)은
 * 이 모듈이 아니라 subscription-reminders.ts가 책임진다.
 */

export type SubscriptionScope = 'business' | 'personal';
export type BillingCycle = 'monthly' | 'yearly';
export type ScopeFilter = 'all' | SubscriptionScope;

export type Subscription = {
  id: string;
  name: string;
  /** 결제 1회당 금액(원, 정수). 연 결제면 1년치 금액. */
  amountKrw: number;
  cycle: BillingCycle;
  scope: SubscriptionScope;
  /** 사용자가 입력한 '다음 결제일'. 이후 결제일은 이 날짜를 기준으로 계산한다. */
  billingAnchorDate: string;
  cancelDeadline: string | null;
  lastUsedDate: string | null;
  /** ISO timestamp. 한 번도 안 쓴 구독의 미사용 기간 계산 기준. */
  createdAt: string | null;
};

/** 해지 후보 기준 — 초안 값. 테스트하며 조정한다. */
export const CANCEL_CANDIDATE_RULE = { unusedDays: 30, minMonthlyAmountKrw: 5000 } as const;
/** 결제·해지기한 '임박' 기준(일). */
export const URGENT_WINDOW_DAYS = 7;

export const SCOPE_LABEL: Record<SubscriptionScope, string> = { business: '사업', personal: '개인' };
export const CYCLE_LABEL: Record<BillingCycle, string> = { monthly: '매월', yearly: '매년' };

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;
const MAX_AMOUNT_KRW = 100_000_000;
const MAX_NAME_LENGTH = 60;

type Ymd = { y: number; m: number; d: number };

function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function parseDateKey(value: string | null | undefined): Ymd | null {
  const match = DATE_KEY.exec(String(value || ''));
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

export function isValidDateKey(value: string | null | undefined) {
  return parseDateKey(value) !== null;
}

function toKey({ y, m, d }: Ymd) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 기준일에 n개월을 더한다. 말일을 넘으면 그 달의 말일로 맞춘다(31일 → 2월 28일). */
function addMonthsClamped({ y, m, d }: Ymd, months: number): Ymd {
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12 + 12) % 12 + 1;
  return { y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) };
}

export function daysBetween(fromKey: string, toKey_: string) {
  const a = parseDateKey(fromKey);
  const b = parseDateKey(toKey_);
  if (!a || !b) return NaN;
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / DAY_MS);
}

export function addDaysToKey(key: string, days: number) {
  const p = parseDateKey(key);
  if (!p) return key;
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d) + days * DAY_MS);
  return toKey({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() });
}

/** ISO timestamp → 서울 날짜 키. */
export function seoulDateKeyFromIso(iso: string | null | undefined) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t + 9 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * 오늘 이후(오늘 포함) 가장 가까운 결제일.
 * 사용자가 결제 확인을 누르지 않아도 날짜가 저절로 앞으로 넘어가며, 말일 보정이
 * 누적되지 않도록 항상 처음 입력한 기준일에서 계산한다.
 */
export function nextPaymentDate(anchorKey: string, cycle: BillingCycle, todayKey: string) {
  const anchor = parseDateKey(anchorKey);
  const today = parseDateKey(todayKey);
  if (!anchor || !today) return anchorKey;
  if (anchorKey >= todayKey) return anchorKey;
  const step = cycle === 'yearly' ? 12 : 1;
  const monthsApart = (today.y - anchor.y) * 12 + (today.m - anchor.m);
  let n = Math.max(0, Math.floor(monthsApart / step) - 1);
  for (let guard = 0; guard < 4; guard += 1, n += 1) {
    const candidate = toKey(addMonthsClamped(anchor, n * step));
    if (candidate >= todayKey) return candidate;
  }
  return toKey(addMonthsClamped(anchor, n * step));
}

/** 오늘 이후 결제일을 가까운 순으로 count개. 알림을 미리 여러 건 걸어 둘 때 쓴다. */
export function upcomingPaymentDates(anchorKey: string, cycle: BillingCycle, todayKey: string, count: number) {
  const dates: string[] = [];
  let from = todayKey;
  for (let i = 0; i < count; i += 1) {
    const next = nextPaymentDate(anchorKey, cycle, from);
    dates.push(next);
    from = addDaysToKey(next, 1);
  }
  return dates;
}

/** 월 환산 금액(원 단위 반올림). 연 결제는 12로 나눈다. */
export function monthlyAmountKrw(sub: Pick<Subscription, 'amountKrw' | 'cycle'>) {
  return sub.cycle === 'yearly' ? Math.round(sub.amountKrw / 12) : sub.amountKrw;
}

function yearlyAmountKrw(sub: Pick<Subscription, 'amountKrw' | 'cycle'>) {
  return sub.cycle === 'yearly' ? sub.amountKrw : sub.amountKrw * 12;
}

export function filterByScope<T extends Pick<Subscription, 'scope'>>(subs: readonly T[], filter: ScopeFilter) {
  return filter === 'all' ? [...subs] : subs.filter((s) => s.scope === filter);
}

export type SubscriptionSummary = {
  count: number;
  monthlyTotalKrw: number;
  yearlyTotalKrw: number;
  byScope: Record<SubscriptionScope, { count: number; monthlyTotalKrw: number }>;
};

export function summarizeSubscriptions(subs: readonly Subscription[]): SubscriptionSummary {
  const yearly = subs.reduce((sum, s) => sum + yearlyAmountKrw(s), 0);
  const scopeSummary = (scope: SubscriptionScope) => {
    const scoped = subs.filter((s) => s.scope === scope);
    return {
      count: scoped.length,
      monthlyTotalKrw: Math.round(scoped.reduce((sum, s) => sum + yearlyAmountKrw(s), 0) / 12),
    };
  };
  return {
    count: subs.length,
    monthlyTotalKrw: Math.round(yearly / 12),
    yearlyTotalKrw: yearly,
    byScope: { business: scopeSummary('business'), personal: scopeSummary('personal') },
  };
}

/** 기본 정렬: 월 환산 금액 큰 순, 같으면 이름순. */
export function sortByMonthlyAmountDesc<T extends Pick<Subscription, 'amountKrw' | 'cycle' | 'name'>>(subs: readonly T[]) {
  return [...subs].sort((a, b) => monthlyAmountKrw(b) - monthlyAmountKrw(a) || a.name.localeCompare(b.name, 'ko'));
}

export type UrgentKind = 'payment' | 'cancel-deadline';
export type UrgentItem = { subscription: Subscription; kind: UrgentKind; date: string; daysUntil: number };

/** 이번 주(7일 이내) 결제 예정 + 해지기한 임박 항목. 날짜가 빠른 순. */
export function urgentItems(subs: readonly Subscription[], todayKey: string, windowDays = URGENT_WINDOW_DAYS): UrgentItem[] {
  const items: UrgentItem[] = [];
  for (const subscription of subs) {
    const payment = nextPaymentDate(subscription.billingAnchorDate, subscription.cycle, todayKey);
    const paymentIn = daysBetween(todayKey, payment);
    if (paymentIn >= 0 && paymentIn <= windowDays) items.push({ subscription, kind: 'payment', date: payment, daysUntil: paymentIn });
    if (subscription.cancelDeadline) {
      const deadlineIn = daysBetween(todayKey, subscription.cancelDeadline);
      if (deadlineIn >= 0 && deadlineIn <= windowDays) items.push({ subscription, kind: 'cancel-deadline', date: subscription.cancelDeadline, daysUntil: deadlineIn });
    }
  }
  return items.sort((a, b) => a.daysUntil - b.daysUntil || (a.kind === b.kind ? 0 : a.kind === 'cancel-deadline' ? -1 : 1));
}

/** 마지막 사용 후 지난 일수. 한 번도 안 썼으면 등록일 기준. 기준일을 알 수 없으면 null. */
export function daysSinceUse(sub: Pick<Subscription, 'lastUsedDate' | 'createdAt'>, todayKey: string) {
  const base = sub.lastUsedDate || seoulDateKeyFromIso(sub.createdAt);
  if (!base) return null;
  const days = daysBetween(base, todayKey);
  return Number.isNaN(days) ? null : Math.max(0, days);
}

/** 금액이 크고 오래 안 쓴 구독. 구분(사업/개인)과 무관하게 전체에서 판단한다. */
export function isCancelCandidate(sub: Subscription, todayKey: string, rule = CANCEL_CANDIDATE_RULE) {
  const idle = daysSinceUse(sub, todayKey);
  return idle !== null && idle >= rule.unusedDays && monthlyAmountKrw(sub) >= rule.minMonthlyAmountKrw;
}

export type SubscriptionRow = {
  subscription: Subscription;
  monthlyAmountKrw: number;
  nextPayment: string;
  daysToPayment: number;
  idleDays: number | null;
  usedToday: boolean;
  cancelCandidate: boolean;
};

/** 화면 한 줄에 필요한 값을 한 번에 계산한다. 정렬은 월 환산 금액 큰 순. */
export function buildSubscriptionRows(subs: readonly Subscription[], filter: ScopeFilter, todayKey: string): SubscriptionRow[] {
  return sortByMonthlyAmountDesc(filterByScope(subs, filter)).map((subscription) => {
    const nextPayment = nextPaymentDate(subscription.billingAnchorDate, subscription.cycle, todayKey);
    return {
      subscription,
      monthlyAmountKrw: monthlyAmountKrw(subscription),
      nextPayment,
      daysToPayment: daysBetween(todayKey, nextPayment),
      idleDays: daysSinceUse(subscription, todayKey),
      usedToday: subscription.lastUsedDate === todayKey,
      cancelCandidate: isCancelCandidate(subscription, todayKey),
    };
  });
}

export function formatWon(value: number) {
  const rounded = Math.round(value);
  const grouped = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${rounded < 0 ? '-' : ''}${grouped}원`;
}

/** '12,000원' · '12000' 같은 입력에서 숫자만 읽는다. 숫자가 없거나 정수가 아니면 null. */
export function parseAmountInput(text: string) {
  const digits = String(text || '').replace(/[,\s원]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

export type SubscriptionDraft = {
  name: string;
  amountText: string;
  cycle: BillingCycle;
  scope: SubscriptionScope;
  billingAnchorDate: string;
  cancelDeadline: string;
};

export type SubscriptionDraftErrors = Partial<Record<'name' | 'amount' | 'billingAnchorDate' | 'cancelDeadline', string>>;

export function validateSubscriptionDraft(draft: SubscriptionDraft): { ok: true; value: Omit<Subscription, 'id' | 'lastUsedDate' | 'createdAt'> } | { ok: false; errors: SubscriptionDraftErrors } {
  const errors: SubscriptionDraftErrors = {};
  const name = draft.name.trim();
  if (!name) errors.name = '서비스 이름을 입력해주세요.';
  else if (name.length > MAX_NAME_LENGTH) errors.name = `이름은 ${MAX_NAME_LENGTH}자 이하로 입력해주세요.`;
  const amount = parseAmountInput(draft.amountText);
  if (amount === null || amount <= 0) errors.amount = '금액을 숫자로 입력해주세요.';
  else if (amount > MAX_AMOUNT_KRW) errors.amount = '금액이 너무 큽니다. 다시 확인해주세요.';
  if (!isValidDateKey(draft.billingAnchorDate)) errors.billingAnchorDate = '결제일을 2026-11-15 형식으로 입력해주세요.';
  const deadline = draft.cancelDeadline.trim();
  if (deadline && !isValidDateKey(deadline)) errors.cancelDeadline = '해지기한을 2026-11-15 형식으로 입력하거나 비워주세요.';
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      amountKrw: amount as number,
      cycle: draft.cycle,
      scope: draft.scope,
      billingAnchorDate: draft.billingAnchorDate,
      cancelDeadline: deadline || null,
    },
  };
}
