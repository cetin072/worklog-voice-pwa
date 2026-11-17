import { parseKoreanDateExpression, countKoreanDateSignals, parseKoreanTimeExpression, countKoreanTimeSignals } from './korean-date-core.mjs';
import { extractScheduleFromText } from './schedule-extract.mjs';

const EVENT = /회의|미팅|약속|면담|상담|방문|만나|교육|행사|예약|식사|출발|도착/;
const CHANGE = /취소|변경|연기|미뤄|미루|안\s*만나|없던\s*일|안\s*하기|하지\s*(?:말|않)|없(?:어|습|음)|안\s*(?:해|하|가|갈|할)|못\s*(?:가|해|하)|완료|끝났|아니고|대신|어때|어떨|할까|가능|괜찮|\?|？/;
const DATE = /(20\d{2})[년.\/-]\s*(\d{1,2})[월.\/-]\s*(\d{1,2})일?/;
const normalized = s => s.replace(/(20\d{2})[.\/-]\s*(\d{1,2})[.\/-]\s*(\d{1,2})\.?/g, '$1년 $2월 $3일')
  .replace(/오후\s*(1[3-9]|2[0-3])\s*시/g, '$1시');
const EVENT_FIELD = /^(?:[^\p{L}\p{N}]+\s*|[\p{L}]{1,2}\s+)?((?:행사|교육|공연|세미나|포럼|회의)\s*(?:일시|시작(?:\s*(?:일시|시간))?)|등록\s*시간|(?:행사\s*)?장소|주소)\s*:\s*(.*)$/u;
const EVENT_HEADING = /^[^:!?？]{2,100}(?:포럼|세미나|설명회|워크숍|컨퍼런스|박람회|회의|교육|공연|행사)(?:\s*20\d{2})?$/;
const START_VALUE = /^(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일(?:\s*\(([월화수목금토일])(?:요일)?\))?\s+(.+)$/;
const CLOCK = /\b(?:[01]?\d|2[0-3])\s*:\s*[0-5]\d\b/;

function structuredEvent(lines, now, review) {
  const fields = [];
  const fieldLines = new Set();
  for (const [index, line] of lines.entries()) {
    const match = line.match(EVENT_FIELD);
    if (!match) continue;
    const next = lines[index + 1];
    const continuation = !match[2] && next && !EVENT_FIELD.test(next);
    const label = match[1].replace(/\s/g, '');
    fields.push({ label, value: match[2] || (continuation ? next : ''), index });
    fieldLines.add(index);
    if (continuation) fieldLines.add(index + 1);
  }
  const starts = fields.filter(({ label }) => /(?:일시|시작|시작시간)$/.test(label));
  if (!starts.length) return null;
  // Forms append a report prompt unrelated to the event's status.
  const prose = lines.filter(line => !/^양식이\s*의심스러운가요\?\s*보고서$/.test(line)).join(' ');
  if (CHANGE.test(prose)) return review('changed_or_multiple_conversations');
  if (starts.length !== 1) return review('ambiguous_date_or_time');
  const [start] = starts;
  const relatedTimes = lines.filter((_, index) => !fieldLines.has(index)).join(' ');
  const registration = fields.filter(({ label }) => label === '등록시간');
  const clockOnly = /^(?:[01]?\d|2[0-3])\s*:\s*[0-5]\d\s*(?:부터)?$/;
  if (registration.length > 1 || registration.some(({ value }) => !clockOnly.test(value)) ||
    countKoreanDateSignals(normalized(relatedTimes), { policy: 'journal' }) || countKoreanTimeSignals(relatedTimes) || CLOCK.test(relatedTimes)) {
    return review('ambiguous_date_or_time');
  }
  const title = lines.slice(0, start.index).findLast((line, index) => !fieldLines.has(index) && EVENT_HEADING.test(line));
  const parts = normalized(start.value).match(START_VALUE);
  if (!title || !parts) return review('ambiguous_date_or_time');
  const [, year, month, day, weekday, clock] = parts;
  const date = parseKoreanDateExpression(`${year}년 ${month}월 ${day}일`, now, { policy: 'journal' });
  const dateKey = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  if (date?.key !== dateKey || (weekday && '일월화수목금토'[new Date(dateKey).getUTCDay()] !== weekday)) return review('invalid_calendar_date');
  const colonClock = clock.match(/^(\d{1,2})\s*:\s*([0-5]\d)$/);
  const time = colonClock && Number(colonClock[1]) <= 23
    ? { hour: Number(colonClock[1]), minute: Number(colonClock[2]), raw: clock }
    : parseKoreanTimeExpression(clock);
  if (!time || time.raw !== clock) return review('ambiguous_time');
  const hhmm = `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
  const startsAt = `${dateKey}T${hhmm}:00+09:00`;
  if (!Number.isFinite(Date.parse(now)) || Date.parse(startsAt) <= Date.parse(now)) return review('past_event');
  const venue = fields.find(({ label }) => label.endsWith('장소'))?.value;
  const address = fields.find(({ label }) => label === '주소')?.value;
  const description = [venue, address && `주소: ${address}`, registration[0] && `등록 ${registration[0].value}`].filter(Boolean).join(' · ').slice(0, 200);
  return { kind: 'schedule', title, date: dateKey, time: hhmm, startsAt, description,
    reason: 'labeled_event', transcript: title, status: '진행중', followUp: description };
}

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
  const structured = structuredEvent(lines.map(line => line.normalize('NFKC')), now, review);
  if (structured) return structured;
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
