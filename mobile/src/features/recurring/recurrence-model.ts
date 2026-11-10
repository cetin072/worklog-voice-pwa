import { shiftDay } from '../home/home-calendar-model';

/** Dates are Seoul calendar days, never local/UTC instants. Weekdays: Monday=1, Sunday=7. */
export type RepeatRule = { kind: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'after-completion'; anchor: string; interval: number; weekdays: number[]; unit: 'day' | 'week' };
export type RepeatRevision = { version: number; from: string; title: string; time: string; sourceScheduleId?: string; sourceScheduleIds?: string[]; rule: RepeatRule };
export type OccurrenceState = { key: string; originalDate: string; dueDate: string; title?: string; time?: string; status: 'pending' | 'completed' | 'skipped'; completedOn: string | null; nextDate?: string | null };
export type RepeatState = { revisions: RepeatRevision[]; pauses: { from: string; to: string | null }[]; endedOn: string | null; occurrences: Record<string, OccurrenceState> };
export type RepeatingWork = { workRecordId: string; version: number; state: RepeatState };
export type RepeatOccurrence = OccurrenceState & { workRecordId: string; title: string; time: string; ruleVersion: number };
export const REPEAT_LABEL = { daily: '매일', weekly: '매주', monthly: '매월', yearly: '매년', 'after-completion': '완료 후' } as const;

export function validDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number(day.slice(0,4)) >= 1900 && Number(day.slice(0,4)) <= 2199 && Number.isFinite(Date.parse(day + 'T12:00:00Z')) && new Date(day + 'T12:00:00Z').toISOString().slice(0,10) === day;
}
const dayNumber = (day: string) => Date.parse(day + 'T12:00:00Z') / 86400000;
const weekday = (day: string) => (new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7 + 1;
const month = (day: string) => Number(day.slice(0,4)) * 12 + Number(day.slice(5,7));
const lastDay = (day: string) => new Date(Date.UTC(Number(day.slice(0,4)),Number(day.slice(5,7)),0)).getUTCDate();
export function validateRule(rule: RepeatRule) {
  if (!Object.hasOwn(REPEAT_LABEL, rule.kind) || !validDay(rule.anchor) || !Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > 365) throw new Error('반복 주기와 시작일을 확인해주세요.');
  if (!Array.isArray(rule.weekdays) || rule.weekdays.some(d => !Number.isInteger(d) || d < 1 || d > 7) || (rule.kind === 'weekly' && !rule.weekdays.length)) throw new Error('반복 요일을 선택해주세요.');
  if (!['day','week'].includes(rule.unit)) throw new Error('반복 단위를 확인해주세요.');
  return rule;
}
export function matchesRule(rule: RepeatRule, date: string) {
  if (date < rule.anchor) return false;
  const days = dayNumber(date) - dayNumber(rule.anchor);
  if (rule.kind === 'daily') return days % rule.interval === 0;
  if (rule.kind === 'weekly') {
    const monday = dayNumber(rule.anchor) - weekday(rule.anchor) + 1;
    return Math.floor((dayNumber(date) - monday) / 7) % rule.interval === 0 && rule.weekdays.includes(weekday(date));
  }
  if (rule.kind === 'monthly') return (month(date) - month(rule.anchor)) % rule.interval === 0 && Number(date.slice(8)) === Math.min(Number(rule.anchor.slice(8)),lastDay(date));
  if (rule.kind === 'yearly') return (Number(date.slice(0,4)) - Number(rule.anchor.slice(0,4))) % rule.interval === 0 && date.slice(5,7) === rule.anchor.slice(5,7) && Number(date.slice(8)) === Math.min(Number(rule.anchor.slice(8)),lastDay(date));
  return false;
}
function activeOn(state: RepeatState, date: string) {
  return (!state.endedOn || date < state.endedOn) && !state.pauses.some(p => date >= p.from && (!p.to || date < p.to));
}
function occurrence(work: RepeatingWork, revision: RepeatRevision, key: string, date: string): RepeatOccurrence {
  const saved = work.state.occurrences[key];
  return { ...(saved || { key, originalDate: date, dueDate: date, status: 'pending' as const, completedOn: null }), workRecordId: work.workRecordId, title: saved?.title || revision.title, time: saved?.time ?? revision.time, ruleVersion: revision.version };
}
/** Computed projection. No future rows are written. Call per-month or page for old history. */
export function repeatOccurrences(work: RepeatingWork, from: string, through: string): RepeatOccurrence[] {
  if (!validDay(from) || !validDay(through) || from > through || dayNumber(through) - dayNumber(from) > 366) throw new Error('조회 기간은 1년 이내로 선택해주세요.');
  const out = new Map<string, RepeatOccurrence>();
  for (let i = 0; i < work.state.revisions.length; i++) {
    const revision = work.state.revisions[i];
    const end = work.state.revisions[i + 1]?.from;
    const eligible = (day: string) => day >= revision.from && (!end || day < end) && activeOn(work.state, day);
    if (revision.rule.kind === 'after-completion') {
      let seq = 0, date: string | null = revision.rule.anchor;
      // Iterate actual history only, not imagined future completions.
      while (date) {
        for (const pause of work.state.pauses) if (pause.to && date >= pause.from && date < pause.to) date = pause.to;
        const key = `v${revision.version}:i${seq}`;
        const row = occurrence(work, revision, key, date);
        if (eligible(date) && row.dueDate >= from && row.dueDate <= through) out.set(key, row);
        const saved = work.state.occurrences[key];
        if (!saved || saved.status === 'pending') break;
        date = saved.status === 'completed' && saved.completedOn ? shiftDay(saved.completedOn, revision.rule.interval * (revision.rule.unit === 'week' ? 7 : 1)) : saved.nextDate || null;
        seq++;
      }
    } else {
      let date = from > revision.from ? from : revision.from;
      for (; date <= through && (!end || date < end); date = shiftDay(date, 1)) {
        if (eligible(date) && matchesRule(revision.rule, date)) {
          const row = occurrence(work, revision, `v${revision.version}:${date}`, date);
          if (row.dueDate >= from && row.dueDate <= through) out.set(row.key,row);
        }
      }
    }
    // Moved instances must remain discoverable when the logical date is outside the requested month.
    for (const saved of Object.values(work.state.occurrences)) {
      if (!saved.key.startsWith(`v${revision.version}:`) || saved.dueDate < from || saved.dueDate > through) continue;
      if (eligible(saved.originalDate) || saved.status !== 'pending') out.set(saved.key,occurrence(work,revision,saved.key,saved.originalDate));
    }
  }
  return [...out.values()].sort((a,b) => a.dueDate.localeCompare(b.dueDate) || a.key.localeCompare(b.key));
}
export function repeatSummary(rows: RepeatOccurrence[], today: string) {
  const completed = rows.filter(r => r.status === 'completed');
  return { completed: completed.length, skipped: rows.filter(r => r.status === 'skipped').length,
    missed: rows.filter(r => r.status === 'pending' && r.dueDate < today).length,
    lastCompleted: completed.map(r => r.completedOn!).sort().at(-1) || null,
    nextDate: rows.filter(r => r.status === 'pending' && r.dueDate >= today).map(r => r.dueDate).sort()[0] || null };
}
export function newRepeatState(title: string, rule: RepeatRule, time = ''): RepeatState {
  validateRule(rule);
  if (!title.trim() || title.trim().length > 300 || (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) throw new Error('업무 이름과 시간을 확인해주세요.');
  return { revisions: [{ version: 1, from: rule.anchor, title: title.trim(), time, rule }], pauses: [], endedOn: null, occurrences: {} };
}

/** Paginate computation internally by year, without throwing away old missed instances. */
export function repeatHistory(work: RepeatingWork, through: string): RepeatOccurrence[] {
  const start = work.state.revisions[0]?.from;
  if (!start || start > through) return [];
  const rows: RepeatOccurrence[] = [];
  for (let year = Number(start.slice(0,4)); year <= Number(through.slice(0,4)); year++) {
    const from = `${year}-01-01` < start ? start : `${year}-01-01`;
    const to = `${year}-12-31` > through ? through : `${year}-12-31`;
    rows.push(...repeatOccurrences(work,from,to));
  }
  return rows;
}
