import { parseKoreanDateExpression, countKoreanDateSignals, parseKoreanTimeExpression, countKoreanTimeSignals } from './korean-date-core.mjs';
import { extractScheduleFromText } from './schedule-extract.mjs';

const EVENT = /회의|미팅|약속|면담|상담|방문|만나|교육|행사|예약|식사|출발|도착/;
const CHANGE = /취소|변경|연기|미뤄|미루|안\s*만나|없던\s*일|안\s*하기|하지\s*(?:말|않)|없(?:어|습|음)|안\s*(?:해|하|가|갈|할)|못\s*(?:가|해|하)|완료|끝났|아니고|대신|어때|어떨|할까|가능|괜찮|\?|？/;
const DATE = /(20\d{2})[년.\/-]\s*(\d{1,2})[월.\/-]\s*(\d{1,2})일?/;
const normalized = s => s.replace(/(20\d{2})[.\/-]\s*(\d{1,2})[.\/-]\s*(\d{1,2})\.?/g, '$1년 $2월 $3일')
  .replace(/오후\s*(1[3-9]|2[0-3])\s*시/g, '$1시');

/** Conservative capture input policy. Reuses date Core; never anchors to screenshot time. */
export function captureScheduleInput(ocr, now = new Date().toISOString()) {
  const lines = String(ocr || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (!lines.length) throw new Error('CAPTURE_NO_TEXT');
  const headers = lines.filter(x => /^(?:20\d{2}[년.\/-]\s*\d{1,2}[월.\/-]\s*\d{1,2}일?\.?)(?:\s*[월화수목금토일]요일)?$/.test(x));
  const body = lines.filter(x => !headers.includes(x) && !/^(?:오전|오후)?\s*\d{1,2}:\d{2}(?:\s*[AP]M)?$/.test(x)
    && !/^채팅|^메시지를 입력|^읽음$|^사진$/.test(x)).map(x => x.replace(/\s+(?:오전|오후)\s*\d{1,2}:\d{2}\s*$/, ''));
  const text = normalized(body.join(' '));
  const eventLine = body.find(x => EVENT.test(x));
  const place = body.find(x => /^(?:장소|위치|주소)\s*[:：]/.test(x));
  // A review record still needs one useful sentence when event wording is unfamiliar.
  const reviewLine = eventLine || body.find(x => countKoreanDateSignals(normalized(x), { policy: 'journal' }) || countKoreanTimeSignals(x)) || body.find(x => x.length >= 6);
  const relevant = [reviewLine, place && place !== reviewLine ? place : ''].filter(Boolean).join(' · ');
  const description = (relevant || '날짜와 약속 내용을 확인해주세요.').slice(0, 200);
  const review = reason => ({ kind: 'review', title: description.slice(0, 140), date: '', time: '', description, reason,
    // Dates stay in a non-parsed existing followUp field, never in transcript.
    reviewContentTitle: true, transcript: '캡처 일정 확인 필요', status: '확인필요', followUp: description });
  if (headers.length > 1 || CHANGE.test(text)) return review('changed_or_multiple_conversations');
  if (!EVENT.test(text)) return review('no_confirmed_event');
  const header = headers[0] && normalized(headers[0]).match(DATE);
  const explicit = text.match(DATE);
  const chatClock = lines.some(x => /(?:^|\s)(?:오전|오후)\s*\d{1,2}:\d{2}$/.test(x));
  if (!explicit && (!header || !/[월화수목금토일]요일/.test(headers[0]) || !chatClock)) return review('conversation_date_unknown');
  for (const parts of [header, explicit].filter(Boolean)) {
    const checked = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])));
    if (checked.getUTCFullYear() !== Number(parts[1]) || checked.getUTCMonth() + 1 !== Number(parts[2]) || checked.getUTCDate() !== Number(parts[3])) return review('invalid_calendar_date');
  }
  const anchor = header ? `${header[1]}-${header[2].padStart(2,'0')}-${header[3].padStart(2,'0')}T12:00:00+09:00` : now;
  if (!Number.isFinite(Date.parse(anchor))) return review('invalid_conversation_date');
  if (countKoreanDateSignals(text, { policy: 'journal' }) !== 1 || countKoreanTimeSignals(text) !== 1) return review('ambiguous_date_or_time');
  const date = parseKoreanDateExpression(text, anchor, { policy: 'journal' });
  const time = parseKoreanTimeExpression(text);
  if (!date || !time || !/(오전|오후|아침|저녁|밤|정오|자정|\b(?:1[3-9]|2[0-3])시|\b(?:[01]?\d|2[0-3]):[0-5]\d)/.test(text)) return review('ambiguous_time');
  const hhmm = `${String(time.hour).padStart(2,'0')}:${String(time.minute).padStart(2,'0')}`;
  const startsAt = `${date.key}T${hhmm}:00+09:00`;
  if (Date.parse(startsAt) <= Date.parse(now)) return review('past_event');
  // Send one bounded appointment line; neither sender names nor the whole chat.
  const title = String(extractScheduleFromText(normalized(relevant), anchor).text || description).slice(0, 140);
  const [year,month,day] = date.key.split('-');
  const clock = `${time.hour < 12 ? '오전' : '오후'} ${time.hour % 12 || 12}시 ${time.minute}분`;
  const transcript = `${year}년 ${Number(month)}월 ${Number(day)}일 ${clock} 약속: ${title}`;
  return { kind: 'schedule', title, date: date.key, time: hhmm, startsAt, description, reason: 'single_explicit_event', transcript, status: '진행중', followUp: '' };
}
