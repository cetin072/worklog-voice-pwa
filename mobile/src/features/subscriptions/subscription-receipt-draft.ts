import { isValidDateKey, parseAmountInput, parseUsdCents, type BillingCycle, type SubscriptionDraft } from './subscription-model';

const FIELD_LABELS = {
  name: /상품명|서비스명|구독명|product name|service name|subscription name/i,
  amount: /결제\s*금액|청구\s*금액|amount charged|payment amount/i,
  method: /결제\s*(?:수단|방법)|payment method/i,
  period: /(?:결제|구독|청구)\s*주기|billing cycle|billing frequency/i,
  date: /다음\s*(?:결제|청구)일|갱신일|next (?:billing|payment) date|renewal date/i,
  total: /합계|total/i,
};

const LABEL_START = new RegExp(`^(?:${Object.values(FIELD_LABELS).map(label => label.source).join('|')}|주문\\s*(?:날짜|번호)|결제\\s*일시|내\\s*계정)(?=[: \\t]|$)`, 'i');

function readField(lines: string[], label: RegExp) {
  const pattern = new RegExp(`^(?:${label.source})(?:[ \\t]*:[ \\t]*|[ \\t]+|$)(.*)$`, 'i');
  const values = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const match = pattern.exec(line);
    if (!match) continue;
    const next = lines[index + 1];
    const value = match[1] || (next && !LABEL_START.test(next) ? next : '');
    if (value) values.add(value);
  }
  return values.size > 1 ? null : [...values][0] || '';
}

const CYCLE_TOKEN = /매[ \t]*(?:월|달|년)|월간|연간|1개월|1년|monthly|yearly|annual/i;

function billingCycle(value: string): BillingCycle | undefined {
  const compact = value.replace(/[ \t]/g, '').toLowerCase();
  if (/^(?:매월|매달|월간|1개월|monthly)$/.test(compact)) return 'monthly';
  if (/^(?:매년|연간|1년|yearly|annual)$/.test(compact)) return 'yearly';
}

const PRICE = new RegExp(
  `(?:(${CYCLE_TOKEN.source})[ \\t]*)?((?:[₩$][ \\t]*|(?:USD|KRW)[ \\t]+)[\\d,.]+(?:[ \\t]*(?:원|달러|USD|KRW))?|[\\d,.]+[ \\t]*(?:원|달러|USD|KRW))$`,
  'i',
);

function pricedLine(line: string) {
  const normalized = line.replace(/\\(?=[ \t]*\d)/g, '₩');
  const match = PRICE.exec(normalized);
  if (!match || (match.index > 0 && !/[ \t]$/.test(normalized.slice(0, match.index)))) return null;
  return {
    name: normalized.slice(0, match.index).trim(),
    amount: match[2],
    cycle: billingCycle(match[1] || ''),
  };
}

function productName(value: string) {
  return /\p{L}/u.test(value) && !/[@:]|^(?:상품|가격|합계)$|^(?:자동\s*갱신|Play\s*포인트)/i.test(value) ? value : '';
}

function googlePlayReceipt(lines: string[], totalValue: string | null) {
  if (!lines.some(line => /\bGoogle[ \t]+Play\b/i.test(line))) return null;
  const header = lines.findIndex(line => /^상품(?:[ \t]+가격|[ \t]{2,}[^\d:]+)?$/.test(line));
  if (header < 0) return null;

  const rows = lines.slice(header + 1);
  const end = rows.findIndex(line => LABEL_START.test(line) || /^Play\s*포인트/i.test(line));
  const products = rows.slice(0, end < 0 ? undefined : end).join('\n')
    .replace(/^([^\n]*\([^()\n]*?)([ \t]{2,}[^\n]*)?\n(\p{L}[^()\n]*\))([^\n]*)$/gmu,
      (_match, start: string, firstPrice: string | undefined, finish: string, secondPrice: string) => {
        const price = [firstPrice?.trim(), secondPrice.trim()].find(value => value && pricedLine(value)?.name === '');
        const separator = start.endsWith('(') ? '' : ' ';
        return `${start.trimEnd()}${separator}${finish}${price ? ` ${price}` : ''}`;
      }).split('\n')
    .filter(line => !/^(?:가격$|자동\s*갱신되는|\(?VAT\b)/i.test(line));

  const pricedProducts = products.flatMap((line, index) => {
    const price = pricedLine(line);
    if (!price) return [];
    const standaloneCycle = !price.name && !price.cycle ? billingCycle(products[index - 1] || '') : undefined;
    const titleIndex = price.name ? index : index - (standaloneCycle ? 2 : 1);
    const candidate = products[titleIndex] || '';
    const titleLine = price.name || (!pricedLine(candidate) ? candidate : '');
    return [{ ...price, name: productName(titleLine), cycle: price.cycle || standaloneCycle }];
  });
  if (pricedProducts.length > 1) return null;

  const product = pricedProducts[0];
  const totalStart = lines.findIndex(line => /^(?:합계|total)(?=[: \t]|$)/i.test(line));
  const splitTotal = totalStart >= 0 && totalValue && billingCycle(totalValue)
    ? lines.slice(totalStart + 1, totalStart + 3).find(line => {
        const price = pricedLine(line);
        return price && !price.name;
      })
    : undefined;
  const total = pricedLine(splitTotal ? `${totalValue} ${splitTotal}` : totalValue || '');
  const totalPrice = total && !total.name ? total : null;
  const name = product?.name || (products.length === 1 && totalPrice ? productName(products[0]) : '');
  const cycle = totalPrice?.cycle && product?.cycle && totalPrice.cycle !== product.cycle
    ? undefined
    : totalPrice?.cycle || product?.cycle;
  return { name, amount: totalValue === null ? undefined : totalPrice?.amount || product?.amount, cycle };
}

/** A payment date is not the next billing date. */
export function subscriptionReceiptDraft(text: string): Partial<SubscriptionDraft> | null {
  const lines = text.normalize('NFKC').split(/\r?\n/)
    .map(line => line.trim().replace(/^[-•·][ \t]*/, '')).filter(Boolean);
  const play = googlePlayReceipt(lines, readField(lines, FIELD_LABELS.total));
  const name = readField(lines, FIELD_LABELS.name) || play?.name;
  const labeledAmount = readField(lines, FIELD_LABELS.amount);
  const amount = (labeledAmount === null ? '' : labeledAmount || play?.amount || '').replace(/\\(?=[ \t]*\d)/g, '₩');
  const method = readField(lines, FIELD_LABELS.method) || '';
  const period = readField(lines, FIELD_LABELS.period);
  const date = readField(lines, FIELD_LABELS.date) || '';
  const parsed: Partial<SubscriptionDraft> = {};
  if (name && name.length <= 60 && !name.includes('@')) parsed.name = name;
  const usd = /(?:^\$|\bUSD\b|달러$)/i.test(amount);
  if (usd && !/원|KRW|₩/i.test(amount)) {
    const cents = parseUsdCents(amount.replace(/\bUSD\b|달러$/gi, '').trim().replace(/^\$[ \t]+/, '$'));
    if (cents !== null && cents > 0) {
      parsed.currency = 'USD';
      parsed.amountText = (cents / 100).toFixed(2);
    }
  } else if (/^(?:(?:₩|KRW)[ \t]*)?(?:\d+|\d{1,3}(?:,\d{3})+)[ \t]*(?:원|KRW)?$/i.test(amount) && /₩|원|KRW/i.test(amount)) {
    const won = parseAmountInput(amount.replace(/₩|KRW/gi, ''));
    if (won !== null && won > 0) parsed.amountText = String(won);
  }
  const cycle = period === '' ? play?.cycle : billingCycle(period || '');
  if (cycle) parsed.cycle = cycle;
  const dateParts = /^(\d{4})\s*(?:년|[-./])\s*(\d{1,2})\s*(?:월|[-./])\s*(\d{1,2})\s*(?:일|\.)?$/.exec(date);
  if (dateParts) {
    const key = `${dateParts[1]}-${dateParts[2].padStart(2, '0')}-${dateParts[3].padStart(2, '0')}`;
    if (isValidDateKey(key)) parsed.billingAnchorDate = key;
  }
  // Only copy a recognized provider. Never carry receipt account/card details into the form.
  const provider = /카카오\s*페이(?:머니)?|\bkakao[ \t]*pay\b|네이버\s*페이|토스\s*페이|페이팔|\bPayPal\b/i.exec(method);
  if (provider) {
    parsed.paymentMethod = 'other';
    parsed.paymentName = /^kakao/i.test(provider[0]) ? '카카오페이' : provider[0].replace(/\s+/g, '');
  } else if (/카드|\b(?:credit|debit) card\b/i.test(method)) parsed.paymentMethod = 'card';
  else if (/자동이체|\bdirect debit\b/i.test(method)) parsed.paymentMethod = 'bank_transfer';
  return Object.keys(parsed).length > 0 ? parsed : null;
}
