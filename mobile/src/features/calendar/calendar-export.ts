/** Optional output of a confirmed Schedule. Never mutates the canonical record. */
export type CalendarDraft = {
  scheduleId: string; title: string; status: string; timeZone: string;
  allDay: boolean; start: string; end: string;
};
export type CalendarReceipt = { id: string; status: string; sourceId: string; draft?: CalendarDraft };
export type CalendarTarget = { accountId: string; calendarId: string };
export type CalendarExportAdapter = {
  target: CalendarTarget;
  get(id: string): Promise<CalendarReceipt | null>;
  insert(id: string, draft: CalendarDraft): Promise<CalendarReceipt>;
};
export type CalendarExportResult = { state: 'confirmed'; eventId: string; alreadyExists: boolean }
  | { state: 'unknown' | 'blocked' | 'cancelled' | 'expired' | 'denied' | 'offline'; message: string };
export const CALENDAR_APPROVAL_MESSAGE = 'Google 캘린더 연결 승인 대기 중입니다. 아직 등록하지 않았습니다. Google 로그인만으로는 캘린더 권한이 부여되지 않습니다.';

function providerFailure(error: unknown): CalendarExportResult | null {
  const code = (error as Error)?.message;
  if (code === 'CALENDAR_EXPIRED') return { state: 'expired', message: 'Google 연결이 만료됐습니다. 다시 연결해주세요.' };
  if (code === 'CALENDAR_DENIED') return { state: 'denied', message: '캘린더 권한이 거부되거나 철회됐습니다. 권한을 확인해주세요.' };
  if (code === 'CALENDAR_OFFLINE') return { state: 'offline', message: '연결되지 않아 결과를 확인하지 못했습니다. 온라인에서 같은 일정을 다시 확인해주세요.' };
  return null;
}

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
  const observed = new Set<string>();
  return function exportOne(draft: CalendarDraft, confirmedTarget: CalendarTarget | null, isCurrent = () => true, verifySource = async () => true): Promise<CalendarExportResult> {
    if (!confirmedTarget || !isCurrent()) return Promise.resolve({ state: 'cancelled', message: '등록을 취소했습니다.' });
    if (!adapter) return Promise.resolve({ state: 'blocked', message: CALENDAR_APPROVAL_MESSAGE });
    if (adapter.target.accountId !== confirmedTarget.accountId || adapter.target.calendarId !== confirmedTarget.calendarId) return Promise.resolve({ state: 'blocked', message: '선택한 계정을 다시 확인해주세요.' });
    try { validateCalendarDraft(draft); } catch (error) { return Promise.resolve({ state: 'blocked', message: (error as Error).message }); }
    const id = calendarEventId(draft.scheduleId);
    if (pending.has(id)) return pending.get(id)!;
    const run = async (): Promise<CalendarExportResult> => {
      const matches = (event: CalendarReceipt | null) => {
        const remote = event?.draft;
        const sameTime = (a: string, b: string) => draft.allDay ? a === b : Date.parse(a) === Date.parse(b);
        return event?.id === id && event.status === 'confirmed' && event.sourceId === draft.scheduleId
          && !!remote && remote.title === draft.title.trim() && remote.allDay === draft.allDay
          && (draft.allDay || remote.timeZone === draft.timeZone) && sameTime(remote.start, draft.start) && sameTime(remote.end, draft.end);
      };
      try {
        const existing = await adapter.get(id);
        if (!isCurrent()) return { state: 'unknown', message: '계정 또는 일정이 변경되어 등록 결과를 표시하지 않았습니다.' };
        if (!await verifySource() || !isCurrent()) return { state: 'blocked', message: '원본 일정이 변경되었습니다. 다시 열어 확인해주세요.' };
        if (existing) {
          if (!matches(existing)) return { state: 'blocked', message: '기존 등록이 삭제됐거나 일치하지 않습니다. Google 캘린더에서 확인해주세요.' };
          observed.add(id);
          return { state: 'confirmed', eventId: id, alreadyExists: true };
        }
        if (observed.has(id)) return { state: 'blocked', message: '전에 확인한 Google 일정이 보이지 않습니다. 원격 삭제 또는 접근 상태를 확인해주세요. 재생성하지 않았습니다.' };
        // Network failure may happen AFTER the server committed. Always read the same ID.
        let insertError: unknown;
        try { await adapter.insert(id, draft); } catch (error) { insertError = error; /* reconcile below; never blind retry */ }
        const saved = await adapter.get(id);
        if (isCurrent() && matches(saved) && await verifySource() && isCurrent()) {
          observed.add(id);
          return { state: 'confirmed', eventId: id, alreadyExists: false };
        }
        if (saved && !matches(saved)) return { state: 'blocked', message: 'Google 일정이 삭제됐거나 확인 내용과 다릅니다. 자동 수정하지 않았습니다.' };
        if (!saved && insertError) { const failure = providerFailure(insertError); if (failure) return failure; }
      } catch (error) {
        // Only local stable codes, never raw provider responses or callback URLs.
        const failure = providerFailure(error); if (failure) return failure;
      }
      return { state: 'unknown', message: '등록 결과 미확인. 연결을 확인하고 다시 확인해주세요. 같은 일정은 같은 ID로 확인합니다.' };
    };
    const promise = run().finally(() => pending.delete(id));
    pending.set(id, promise);
    return promise;
  };
}
