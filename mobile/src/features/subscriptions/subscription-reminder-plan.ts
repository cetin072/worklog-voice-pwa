import {
  addDaysToKey,
  formatWon,
  upcomingPaymentDates,
  type Subscription,
} from './subscription-model';

/** 네이티브 의존이 없는 순수 계획 함수. 실제 예약은 subscription-reminders.ts가 맡는다. */
export const SUBSCRIPTION_REMINDER_ID_PREFIX = 'worklog.subscription.v1.';
export const SUBSCRIPTION_REMINDER_OWNER = 'worklog.subscription-reminder.v1';
/** 결제일/해지기한 하루 전 오전 9시(서울). */
export const REMINDER_HOUR_KST = 9;
/** 구독마다 앞으로 몇 번의 결제일 알림을 미리 걸어 둘지. 앱을 한동안 안 열어도 이어서 울리게 한다. */
export const PAYMENT_OCCURRENCES_AHEAD = 3;
/** 기기에 걸어 두는 알림 총량 상한. 가까운 날짜부터 채운다. */
export const MAX_SUBSCRIPTION_REMINDERS = 50;

export type PlannedSubscriptionReminder = {
  identifier: string;
  triggerAt: string;
  title: string;
  body: string;
  subscriptionId: string;
  kind: 'payment' | 'cancel-deadline';
  date: string;
};

function triggerAtFor(eventDateKey: string) {
  const day = addDaysToKey(eventDateKey, -1);
  return `${day}T${String(REMINDER_HOUR_KST).padStart(2, '0')}:00:00+09:00`;
}

/**
 * 앞으로 걸어 둘 알림 목록. 이미 지난 시각은 제외하고 시각 순으로 상한까지만 돌려준다.
 * 같은 입력이면 항상 같은 identifier를 만들어 재동기화가 중복 알림을 만들지 않는다.
 */
export function planSubscriptionReminders(subs: readonly Subscription[], todayKey: string, nowMs: number, paid: readonly {subscription_id:string;due_date:string}[] = []): PlannedSubscriptionReminder[] {
  const planned: PlannedSubscriptionReminder[] = [];
  const confirmed=new Set(paid.map(r=>`${r.subscription_id}:${r.due_date}`));
  const push = (reminder: PlannedSubscriptionReminder) => {
    if (Date.parse(reminder.triggerAt) > nowMs) planned.push(reminder);
  };
  for (const sub of subs) {
    for (const date of upcomingPaymentDates(sub.billingAnchorDate, sub.cycle, todayKey, PAYMENT_OCCURRENCES_AHEAD)) {
      if(confirmed.has(`${sub.id}:${date}`))continue;
      push({
        identifier: `${SUBSCRIPTION_REMINDER_ID_PREFIX}payment.${sub.id}.${date}`,
        triggerAt: triggerAtFor(date),
        title: '내일 결제 예정',
        body: `${sub.name} ${formatWon(sub.amountKrw)} · ${date.slice(5).replace('-', '/')}`,
        subscriptionId: sub.id,
        kind: 'payment',
        date,
      });
    }
    if (sub.cancelDeadline && sub.cancelDeadline >= todayKey) {
      push({
        identifier: `${SUBSCRIPTION_REMINDER_ID_PREFIX}cancel-deadline.${sub.id}.${sub.cancelDeadline}`,
        triggerAt: triggerAtFor(sub.cancelDeadline),
        title: '내일이 해지기한',
        body: `${sub.name} · 계속 쓸지 확인해보세요`,
        subscriptionId: sub.id,
        kind: 'cancel-deadline',
        date: sub.cancelDeadline,
      });
    }
  }
  return planned
    .sort((a, b) => Date.parse(a.triggerAt) - Date.parse(b.triggerAt) || a.identifier.localeCompare(b.identifier))
    .slice(0, MAX_SUBSCRIPTION_REMINDERS);
}

/** 기기에 예약된 알림 중 구독 알림만 골라낸다. 다른 기능의 알림은 건드리지 않는다. */
export function isSubscriptionReminderRequest(request: { identifier: string; content?: { data?: Record<string, unknown> | null } }) {
  return request.identifier.startsWith(SUBSCRIPTION_REMINDER_ID_PREFIX)
    && request.content?.data?.owner === SUBSCRIPTION_REMINDER_OWNER;
}
