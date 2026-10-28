/** Optional output of a confirmed Schedule. Never mutates the canonical record. */
export type CalendarDraft = {
  scheduleId: string; title: string; status: string; timeZone: string;
  allDay: boolean; start: string; end: string;
};
export type CalendarReceipt = { id: string; status: string; sourceId: string };
export type CalendarTarget = { accountId: string; calendarId: string };
export type CalendarExportAdapter = {
  target: CalendarTarget;
  get(id: string): Promise<CalendarReceipt | null>;
  insert(id: string, draft: CalendarDraft): Promise<CalendarReceipt>;
};
export type CalendarExportResult = { state: 'confirmed'; eventId: string; alreadyExists: boolean }
  | { state: 'unknown' | 'blocked' | 'cancelled'; message: string };
export const CALENDAR_APPROVAL_MESSAGE = 'Google 캘린더 연결 승인 대기 중입니다. 아직 등록하지 않았습니다. Google 로그인만으로는 캘린더 권한이 부여되지 않습니다.';

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}
export function validateCalendarDraft(draft: CalendarDraft) {
  calendarEventId(draft.scheduleId);
  if (draft.status !== 'confirmed' || !draft.title.trim()) throw Error('확정 일정과 제목을 확인해주세요.');
  try { new Intl.DateTimeFormat('en', { timeZone: draft.timeZone }).format(); } catch { throw Error('시간대를 확인해주세요.'); }
  if (draft.allDay) {
    if (!validDate(draft.start) || !validDate(draft.end) || draft.end <= draft.start) throw Error('종일 일정의 시작일과 종료일을 확인해주세요.');
  } else {
    const explicit = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
    if (![draft.start, draft.end].every(v => explicit.test(v) && validDate(v.slice(0, 10)) && Number.isFinite(Date.parse(v)))
      || Date.parse(draft.end) <= Date.parse(draft.start)) throw Error('시작·종료 시각과 시간대를 확인해주세요.');
  }
}

/** One fixed event ID per canonical UUID: survives retry/relaunch and title edits.
 * Google accepts base32hex; a UUID's hexadecimal alphabet is a subset.
 * Deletion/tombstone/mismatch never causes a new random ID or an overwrite.
 */
export function calendarEventId(scheduleId: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(scheduleId)) throw Error('일정 ID를 확인해주세요.');
  return `a${scheduleId.replaceAll('-', '').toLowerCase()}`;
}
export function createCalendarExporter(adapter: CalendarExportAdapter | null) {
  const pending = new Map<string, Promise<CalendarExportResult>>();
  return function exportOne(draft: CalendarDraft, confirmedTarget: CalendarTarget | null, isCurrent = () => true): Promise<CalendarExportResult> {
    if (!confirmedTarget || !isCurrent()) return Promise.resolve({ state: 'cancelled', message: '등록을 취소했습니다.' });
    if (!adapter) return Promise.resolve({ state: 'blocked', message: CALENDAR_APPROVAL_MESSAGE });
    if (adapter.target.accountId !== confirmedTarget.accountId || adapter.target.calendarId !== confirmedTarget.calendarId) return Promise.resolve({ state: 'blocked', message: '선택한 계정을 다시 확인해주세요.' });
    try { validateCalendarDraft(draft); } catch (error) { return Promise.resolve({ state: 'blocked', message: (error as Error).message }); }
    const id = calendarEventId(draft.scheduleId);
    if (pending.has(id)) return pending.get(id)!;
    const run = async (): Promise<CalendarExportResult> => {
      const matches = (event: CalendarReceipt | null) => event?.id === id && event.status === 'confirmed' && event.sourceId === draft.scheduleId;
      try {
        const existing = await adapter.get(id);
        if (!isCurrent()) return { state: 'unknown', message: '계정 또는 일정이 변경되어 등록 결과를 표시하지 않았습니다.' };
        if (existing) return matches(existing)
          ? { state: 'confirmed', eventId: id, alreadyExists: true }
          : { state: 'blocked', message: '기존 등록이 삭제됐거나 일치하지 않습니다. Google 캘린더에서 확인해주세요.' };
        // Network failure may happen AFTER the server committed. Always read the same ID.
        try { await adapter.insert(id, draft); } catch { /* reconcile below; never blind retry */ }
        const saved = await adapter.get(id);
        if (isCurrent() && matches(saved)) return { state: 'confirmed', eventId: id, alreadyExists: false };
      } catch { /* no raw provider errors/tokens in UI */ }
      return { state: 'unknown', message: '등록 결과 미확인. 연결을 확인하고 다시 확인해주세요. 같은 일정은 같은 ID로 확인합니다.' };
    };
    const promise = run().finally(() => pending.delete(id));
    pending.set(id, promise);
    return promise;
  };
}
