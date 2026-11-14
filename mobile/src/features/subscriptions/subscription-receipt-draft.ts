import { isValidDateKey, parseAmountInput, parseUsdCents, type SubscriptionDraft } from './subscription-model';

function uniqueField(text: string, pattern: RegExp) {
  const values = [...new Set([...text.matchAll(pattern)].map(match => match[1].trim()).filter(Boolean))];
  return values.length === 1 ? values[0] : '';
}

function googlePlayReceipt(text: string) {
  if (!/\bGoogle[ \t]+Play\b/i.test(text)) return null;
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const total = uniqueField(text, /^[ \t]*합계[ \t]*[:：][ \t]*(?:\n[ \t]*)?(\S[^\n]*)$/gm);
  const header = lines.findIndex(line => /^상품(?:[ \t]+가격|[ \t]{2,}[^\d:：]+)?$/.test(line));
  if (header < 0 || !lines.some(line => /^가격$/.test(line)) && !/^[ \t]*합계[ \t]*[:：]/m.test(text)) return null;

  const end = lines.findIndex((line, i) => i > header && /^(?:합계\s*[:：]|결제\s*(?:방법|수단)\s*[:：]|Play\s*포인트)/i.test(line));
  const products = lines.slice(header + 1, end < 0 ? undefined : end);
  const names = products.flatMap((line, i) => {
    const title = line.split(/[ \t]+(?:매월|매년|[₩$])/)[0].trim();
    if (!/\bsubscription\b|구독/i.test(title) || /[:：@]|자동\s*갱신/.test(title)) return [];
    const continuation = products[i + 1]?.split(/[ \t]{2,}/)[0];
    return [title.includes('(') && !title.includes(')') && /^[\p{L}][\p{L} .&'-]*\)$/u.test(continuation ?? '')
      ? `${title} ${continuation}` : title];
  });
  // Korean OCR sometimes reads the won glyph as a backslash.
  const price = /^(?:(매월|매달|매년|연간)[ \t]+)?((?:₩[ \t]*|\$[ \t]*|(?:USD|KRW)[ \t]+)?[\d,.]+(?:[ \t]*(?:원|달러|USD|KRW))?)[ \t]*$/i.exec(total.replace(/\\(?=[ \t]*\d)/, '₩'));
  return { name: names.length === 1 ? names[0] : '', amount: price?.[2] ?? '', period: price?.[1] ?? '' };
}

/** A payment date is not the next billing date. */
export function subscriptionReceiptDraft(text: string): Partial<SubscriptionDraft> | null {
  text = text.normalize('NFKC').replace(/^[ \t]*[-•·][ \t]*/gm, '').replace(/\r/g, '');
  const play = googlePlayReceipt(text);
  const name = uniqueField(text, /^\s*(?:상품명|서비스명|구독명)\s*[:：][ \t]*(\S[^\n]*)$/gm) || play?.name;
  const amount = uniqueField(text, /^\s*(?:결제\s*금액|청구\s*금액)\s*[:：][ \t]*(\S[^\n]*)$/gm) || play?.amount || '';
  const method = uniqueField(text, /^[ \t]*결제[ \t]*(?:수단|방법)[ \t]*[:：][ \t]*(?:\n[ \t]*)?(\S[^\n]*)$/gm);
  const period = uniqueField(text, /^\s*(?:결제|구독|청구)\s*주기\s*[:：][ \t]*(\S[^\n]*)$/gm) || play?.period || '';
  const date = uniqueField(text, /^\s*(?:다음\s*(?:결제|청구)일|갱신일)\s*[:：][ \t]*(\S[^\n]*)$/gm);
  const parsed: Partial<SubscriptionDraft> = {};
  if (name && name.length <= 60) parsed.name = name;
  const usd = /(?:^\$|\bUSD\b|달러$)/i.test(amount);
  if (usd && !/원|KRW|₩/i.test(amount)) {
    const cents = parseUsdCents(amount.replace(/\bUSD\b|달러$/gi, '').replace(/^\$[ \t]+/, '$'));
    if (cents !== null && cents > 0) {
      parsed.currency = 'USD';
      parsed.amountText = (cents / 100).toFixed(2);
    }
  } else if (/^(?:₩[ \t]*)?(?:\d+|\d{1,3}(?:,\d{3})+)[ \t]*(?:원|KRW)?$/i.test(amount) && /₩|원|KRW/i.test(amount)) {
    const won = parseAmountInput(amount.replace(/₩|KRW/gi, ''));
    if (won !== null && won > 0) parsed.amountText = String(won);
  }
  if (/^(?:매달|매월|월간|1개월|monthly)$/i.test(period)) parsed.cycle = 'monthly';
  if (/^(?:매년|연간|1년|yearly|annual)$/i.test(period)) parsed.cycle = 'yearly';
  const dateParts = /^(\d{4})\s*(?:년|[-./])\s*(\d{1,2})\s*(?:월|[-./])\s*(\d{1,2})\s*(?:일|\.)?$/.exec(date);
  if (dateParts) {
    const key = `${dateParts[1]}-${dateParts[2].padStart(2, '0')}-${dateParts[3].padStart(2, '0')}`;
    if (isValidDateKey(key)) parsed.billingAnchorDate = key;
  }
  // Only copy a recognized provider. Never carry receipt account/card details into the form.
  const provider = /카카오\s*페이(?:머니)?|kakao[ \t]*pay|네이버\s*페이|토스\s*페이|페이팔|PayPal/i.exec(method);
  if (provider) {
    parsed.paymentMethod = 'other';
    parsed.paymentName = /^kakao/i.test(provider[0]) ? '카카오페이' : provider[0].replace(/\s+/g, '');
  } else if (/카드/.test(method)) parsed.paymentMethod = 'card';
  else if (/자동이체/.test(method)) parsed.paymentMethod = 'bank_transfer';
  return Object.keys(parsed).length > 0 ? parsed : null;
}
