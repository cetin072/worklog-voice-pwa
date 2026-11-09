import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import {
  isValidDateKey,
  PAYMENT_METHOD_LABEL,
  EXPENSE_KIND_LABEL,
  type ExpenseKind,
  type PaymentMethod,
  type BillingCycle,
  type Subscription,
  type SubscriptionScope,
} from './subscription-model';

/** 입력 폼에서 검증을 통과한 값. id/사용일/등록일은 서버가 정한다. sourceText는 새로 만들 때만 보낸다. */
export type SubscriptionInput = Omit<Subscription, 'id' | 'lastUsedDate' | 'createdAt' | 'sourceText'> & { sourceText?: string | null };

const TABLE = 'subscriptions';
const COLUMNS = 'id,name,amount_krw,billing_cycle,scope,billing_anchor_date,cancel_deadline,last_used_date,source_text,created_at,payment_method,payment_name,expense_kind,variable_amount';
const LIST_LIMIT = 500;

type Row = Record<string, unknown>;

function isScope(value: unknown): value is SubscriptionScope {
  return value === 'business' || value === 'personal';
}
function isCycle(value: unknown): value is BillingCycle {
  return value === 'monthly' || value === 'yearly';
}
function dateOrNull(value: unknown) {
  return typeof value === 'string' && isValidDateKey(value.slice(0, 10)) ? value.slice(0, 10) : null;
}

/** 서버 행 → 앱 모델. 형식이 맞지 않는 행은 조용히 고치지 않고 버린다(null). */
export function subscriptionFromRow(row: unknown): Subscription | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Row;
  const anchor = dateOrNull(r.billing_anchor_date);
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || !r.name.trim()) return null;
  if (typeof r.amount_krw !== 'number' || !Number.isInteger(r.amount_krw) || r.amount_krw <= 0) return null;
  if (!isCycle(r.billing_cycle) || !isScope(r.scope) || !anchor) return null;
  if (r.payment_method != null && (typeof r.payment_method !== 'string' || !r.payment_method || !Object.hasOwn(PAYMENT_METHOD_LABEL, r.payment_method))) return null;
  return {
    ...(r.payment_method !== undefined ? { paymentMethod: r.payment_method as PaymentMethod | null, paymentName: typeof r.payment_name === 'string' ? r.payment_name : null } : {}),
    expenseKind: Object.hasOwn(EXPENSE_KIND_LABEL, String(r.expense_kind)) ? r.expense_kind as ExpenseKind : 'subscription',
    variableAmount: r.variable_amount === true,
    id: r.id,
    name: r.name,
    amountKrw: r.amount_krw,
    cycle: r.billing_cycle,
    scope: r.scope,
    billingAnchorDate: anchor,
    cancelDeadline: dateOrNull(r.cancel_deadline),
    lastUsedDate: dateOrNull(r.last_used_date),
    createdAt: typeof r.created_at === 'string' ? r.created_at : null,
    sourceText: typeof r.source_text === 'string' && r.source_text.trim() ? r.source_text : null,
  };
}

function inputToRow(input: SubscriptionInput, { withSource = false } = {}) {
  return {
    ...(withSource && input.sourceText ? { source_text: input.sourceText.slice(0, 300) } : {}),
    ...(input.paymentMethod !== undefined ? { payment_method: input.paymentMethod, payment_name: input.paymentMethod ? input.paymentName || null : null } : {}),
    ...(input.expenseKind !== undefined ? { expense_kind: input.expenseKind, variable_amount: !!input.variableAmount } : {}),
    name: input.name,
    amount_krw: input.amountKrw,
    billing_cycle: input.cycle,
    scope: input.scope,
    billing_anchor_date: input.billingAnchorDate,
    cancel_deadline: input.cancelDeadline,
  };
}

export function subscriptionErrorMessage(error: { code?: string; message?: string } | null | undefined) {
  const text = `${error?.code || ''} ${error?.message || ''}`;
  if (/PGRST205|PGRST204|PGRST202|42703|42P01|does not exist|schema cache/i.test(text)) return '구독 관리를 준비하는 중입니다. 잠시 후 다시 열어주세요.';
  if (/JWT|401|permission|row-level security|42501/i.test(text)) return '로그인 상태를 확인한 뒤 다시 시도해주세요.';
  return '처리하지 못했습니다. 입력은 유지했습니다. 다시 시도해주세요.';
}

function fail(error: { code?: string; message?: string } | null): never {
  throw new Error(subscriptionErrorMessage(error));
}

export async function listSubscriptions(client: PlatformSupabaseClient): Promise<Subscription[]> {
  const { data, error } = await client
    .from(TABLE)
    .select(COLUMNS)
    .is('archived_at', null)
    .order('created_at', { ascending: true })
    .limit(LIST_LIMIT);
  if (error) fail(error);
  return (Array.isArray(data) ? data : []).map(subscriptionFromRow).filter((s): s is Subscription => s !== null);
}

export async function createSubscription(client: PlatformSupabaseClient, input: SubscriptionInput, requestId?: string): Promise<Subscription> {
  try {
    const { data, error } = await client.from(TABLE).insert({ ...inputToRow(input, { withSource: true }), ...(requestId ? { id: requestId } : {}) }).select(COLUMNS).single();
    if (!error) {
      const created = subscriptionFromRow(data);
      if (created) return created;
    }
    if (!requestId) fail(error);
  } catch (error) { if (!requestId) throw error; }
  // Keep the same identifier until confirmed, including after a lost successful response.
  const { data, error } = await client.from(TABLE).select(COLUMNS).eq('id', requestId!).maybeSingle();
  const confirmed = !error ? subscriptionFromRow(data) : null;
  if (confirmed) return confirmed;
  throw new Error('저장 확인 필요 · 입력을 유지했습니다. 같은 내용으로 다시 시도해주세요.');
}

async function updateOwned(client: PlatformSupabaseClient, id: string, patch: Row): Promise<Subscription> {
  // RLS가 본인 행만 허용한다. 갱신된 행이 없으면(남의 행·이미 보관됨) 성공으로 보지 않는다.
  const { data, error } = await client.from(TABLE).update(patch).eq('id', id).is('archived_at', null).select(COLUMNS).maybeSingle();
  if (error) fail(error);
  const updated = subscriptionFromRow(data);
  if (!updated) throw new Error('이미 삭제되었거나 수정할 수 없는 구독입니다. 목록을 새로고침해주세요.');
  return updated;
}

export function updateSubscription(client: PlatformSupabaseClient, id: string, input: SubscriptionInput) {
  return updateOwned(client, id, inputToRow(input));
}

/** '최근 썼음' 한 번 탭. 날짜는 서울 기준 오늘(호출부에서 전달). */
export function markSubscriptionUsed(client: PlatformSupabaseClient, id: string, todayKey: string) {
  if (!isValidDateKey(todayKey)) throw new Error('날짜를 확인하지 못했습니다.');
  return updateOwned(client, id, { last_used_date: todayKey });
}

/** 삭제 대신 보관(archived_at). 목록에서는 사라지지만 기록은 남는다. */
export async function archiveSubscription(client: PlatformSupabaseClient, id: string, now = new Date()) {
  await updateOwned(client, id, { archived_at: now.toISOString() });
}

export type PaymentReceipt = { subscription_id: string; due_date: string; amount_krw: number; name: string; confirmed_at: string };
export async function listPaymentReceipts(client: PlatformSupabaseClient): Promise<PaymentReceipt[]> {
  const { data, error } = await client.from('subscription_payments').select('subscription_id,due_date,amount_krw,name,confirmed_at').order('due_date', { ascending: false }).limit(500);
  if (error) fail(error);
  return (data || []) as PaymentReceipt[];
}
/** Stable (subscription, due-date) key. Lost responses are read back before retry is offered. */
export async function confirmSubscriptionPayment(client: PlatformSupabaseClient, id: string, due: string): Promise<PaymentReceipt> {
  if (!isValidDateKey(due)) throw new Error('결제일을 확인해주세요.');
  const read = async () => {
    const { data, error } = await client.from('subscription_payments').select('subscription_id,due_date,amount_krw,name,confirmed_at').eq('subscription_id', id).eq('due_date', due).maybeSingle();
    return !error && data ? data as PaymentReceipt : null;
  };
  try {
    const { data, error } = await client.rpc('confirm_subscription_payment', { p_subscription_id: id, p_due_date: due });
    if (!error && data) return data as PaymentReceipt;
  } catch { /* May already have committed. Read the same occurrence. */ }
  const found = await read().catch(() => null);
  if (found) return found;
  throw new Error('납부 저장 확인 필요 · 같은 회차로 다시 시도해주세요.');
}
