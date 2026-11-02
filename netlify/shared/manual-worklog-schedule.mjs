import { extractScheduleFromText } from './schedule-extract.mjs';
import { normalizeWorklogDueInput } from './worklog-edit.mjs';

// Structured picker values are authoritative; prose remains the fallback for voice.
export function worklogSchedule(transcript, recordedAt, dueDate = '', dueTime = undefined) {
  const parsed = extractScheduleFromText(transcript, recordedAt);
  if (!dueDate) return parsed;
  const normalized = normalizeWorklogDueInput(dueDate, dueTime ?? (parsed.hasTime ? String(parsed.dueStart).slice(11, 16) : ''));
  // Older installed apps appended this exact picker date to the title.
  const date = dueDate.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1년 $2월 $3일');
  const suffix = new RegExp(`\\s+${date}(?:\\s+(?:오전|오후)\\s+\\d{1,2}시\\s+\\d{1,2}분)?$`);
  return { text: String(transcript).replace(suffix, '').trim(), dueStart: normalized.dueHasTime ? normalized.dueAt : normalized.dueDate,
    dateKey: normalized.dueDate, hasTime: normalized.dueHasTime, matched: true };
}
