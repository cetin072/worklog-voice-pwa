import { createCalendarExporter, type CalendarExportAdapter, type CalendarExportResult, type CalendarTarget } from './calendar-export';
import { confirmedCalendarDraft, sameCalendarSource, type CalendarSource } from './calendar-source';

export type CalendarConnection = {
  target: CalendarTarget; email: string; expiresAt: number; adapter: CalendarExportAdapter;
};

/** One in-memory connection. No token fields enter UI, app sessions or storage. */
export function createCalendarConnection(deps: {
  authorize(): Promise<CalendarConnection | null>; now?(): number;
}) {
  let connection: CalendarConnection | null = null;
  let epoch = 0;
  let connecting: Promise<boolean> | null = null;
  let exporter: ReturnType<typeof createCalendarExporter> | null = null;
  const now = deps.now || Date.now;
  const pending = new Map<string, Promise<CalendarExportResult>>();
  const disconnect = () => { epoch++; connection = null; exporter = null; };
  return {
    disconnect,
    info() { return connection ? { email: connection.email, target: { ...connection.target }, expired: now() >= connection.expiresAt } : null; },
    connect() {
      if (connecting) return connecting;
      disconnect();
      const captured = epoch;
      connecting = deps.authorize().then(next => {
        if (captured !== epoch || !next || next.expiresAt <= now()) return false;
        connection = next; exporter = createCalendarExporter(next.adapter); return true;
      }).finally(() => { connecting = null; });
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
        try {
          const latest = await read();
          if (!isCurrent()) return { state: 'cancelled', message: '계정이 변경되었거나 등록을 취소했습니다.' };
          if (!sameCalendarSource(source, latest)) return { state: 'blocked', message: '원본 일정이 변경되었습니다. 닫고 다시 열어 현재 값을 확인해주세요.' };
          return await send(confirmedCalendarDraft(latest, end), active.target, isCurrent,
            async () => sameCalendarSource(source, await read()));
        } catch { return { state: 'blocked', message: '최신 원본·소유권·종료 시각을 확인하지 못했습니다. 연결과 일정을 다시 확인해주세요.' }; }
      };
      const work = run().finally(() => pending.delete(key)); pending.set(key, work); return work;
    },
  };
}
