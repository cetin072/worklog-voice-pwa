import { providerFailure, calendarReceiptMatches, calendarEventId, createCalendarExporter, type CalendarExportAdapter, type CalendarExportResult, type CalendarTarget } from './calendar-export';
import { confirmedCalendarDraft, sameCalendarSource, type CalendarSource } from './calendar-source';

export type CalendarConnection = {
  target: CalendarTarget; email: string; expiresAt: number; adapter: CalendarExportAdapter; persist?(): Promise<void>;
};

/** Connection state exposes no token fields to UI or app sessions. */
export function createCalendarConnection(deps: {
  authorize(): Promise<CalendarConnection | null>; now?(): number;
  restore?(): Promise<CalendarConnection | null>; clear?(): Promise<void>;
}) {
  let connection: CalendarConnection | null = null;
  let epoch = 0;
  let connecting: Promise<boolean> | null = null;
  let exporter: ReturnType<typeof createCalendarExporter> | null = null;
  const listeners = new Set<() => void>();
  let message = '';
  const notify = () => { for (const listener of listeners) listener(); };
  const now = deps.now || Date.now;
  const pending = new Map<string, Promise<CalendarExportResult>>();
  const disconnect = () => {
    epoch++; connection = null; exporter = null; message = '';
    void deps.clear?.().catch(() => { message = '연결 정보 삭제에 실패했습니다. 다시 연결 해제를 눌러주세요.'; notify(); });
    notify();
  };
  let restoring: Promise<void> | null = null;
  return {
    disconnect,
    restore() {
      if (restoring) return restoring;
      if (connection || connecting || !deps.restore) return Promise.resolve();
      const captured = epoch;
      restoring = deps.restore().then(next => {
        if (captured !== epoch || connection || connecting) return;
        if (next) { connection = next; exporter = createCalendarExporter(next.adapter); }
      }).catch(() => {
        if (captured === epoch) message = '저장된 연결을 확인하지 못했습니다. 다시 시도해주세요.';
      }).finally(() => { restoring = null; notify(); });
      notify();
      return restoring;
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    status() { return { connecting: !!connecting || !!restoring, message }; },
    info() { return connection ? { email: connection.email, target: { ...connection.target }, expired: now() >= connection.expiresAt } : null; },
    connect() {
      if (connecting) return connecting;
      disconnect();
      const captured = epoch;
      connecting = deps.authorize().then(async next => {
        if (captured !== epoch) return false;
        if (!next || next.expiresAt <= now()) { message = '연결을 취소했거나 연결 시간이 만료되었습니다.'; return false; }
        await next.persist?.();
        if (captured !== epoch) return false;
        connection = next; exporter = createCalendarExporter(next.adapter); message = '연결되었습니다.'; return true;
      }).catch(error => {
        if (captured === epoch) message = (error as Error).message === 'CALENDAR_AUTH_DENIED'
          ? '구글 권한 동의가 거부되었습니다.' :
          /^CALENDAR_AUTH_EXCHANGE_\d{3}$/.test((error as Error).message) ? '인증 결과 교환에 실패했습니다. 다시 연결해주세요.' :
          /^CALENDAR_AUTH_IDENTITY_\d{3}$/.test((error as Error).message) ? '연결한 구글 계정을 확인하지 못했습니다.' :
          (error as Error).message === 'CALENDAR_AUTH_TOKEN_MISSING' ? '구글 캘린더 접근 정보를 받지 못했습니다. 권한 동의를 확인해주세요.' : '연결을 완료하지 못했습니다. 다시 연결해주세요.';
        throw error;
      }).finally(() => { connecting = null; notify(); });
      notify();
      return connecting;
    },
    send(source: CalendarSource, end: string, read: () => Promise<CalendarSource>, current: () => boolean) {
      const key = source.scheduleId;
      if (pending.has(key)) return pending.get(key)!;
      const captured = epoch;
      const active = connection;
      const send = exporter;
      const isCurrent = () => current() && captured === epoch && connection === active && !!active && now() < active.expiresAt;
      const run = async (): Promise<CalendarExportResult> => {
        if (!active || !send) return { state: 'blocked', message: 'Google 캘린더 계정을 먼저 연결해주세요.' };
        if (now() >= active.expiresAt) { disconnect(); return { state: 'expired', message: '연결 시간이 만료됐습니다. 다시 연결해주세요.' }; }
        try { confirmedCalendarDraft(source, end); }
        catch (error) { return { state: 'blocked', message: (error as Error).message }; }
        try {
          const latest = await read();
          if (!isCurrent()) return { state: 'cancelled', message: '계정이 변경되었거나 등록을 취소했습니다.' };
          if (!sameCalendarSource(source, latest)) return { state: 'blocked', message: '원본 일정이 변경되었습니다. 닫고 다시 열어 현재 값을 확인해주세요.' };
          if (source.legacyScheduleId && source.legacyScheduleId !== source.scheduleId) {
            const legacyId = calendarEventId(source.legacyScheduleId);
            const legacy = await active.adapter.get(legacyId);
            if (!isCurrent()) return { state: 'cancelled', message: '연결 또는 일정이 변경되었습니다.' };
            if (legacy) {
              if (calendarReceiptMatches(legacy, confirmedCalendarDraft(latest, end), legacyId, source.legacyScheduleId)
                && sameCalendarSource(source, await read()) && isCurrent()) return { state: 'confirmed', eventId: legacyId, alreadyExists: true };
              return { state: 'blocked', message: '이전 Google 등록 내용이 다릅니다. 중복 추가하거나 수정하지 않았습니다.' };
            }
          }
          return await send(confirmedCalendarDraft(latest, end), active.target, isCurrent,
            async () => sameCalendarSource(source, await read()));
        } catch (error) { return providerFailure(error) || { state: 'blocked', message: '최신 원본·소유권·종료 시각을 확인하지 못했습니다. 연결과 일정을 다시 확인해주세요.' }; }
      };
      const work = run().finally(() => pending.delete(key)); pending.set(key, work); return work;
    },
  };
}

