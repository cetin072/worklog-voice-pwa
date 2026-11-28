import type { CalendarReadAdapter, CalendarReadRange } from './calendar-read';
import { providerFailure, calendarReceiptMatches, calendarEventId, createCalendarExporter, type CalendarExportAdapter, type CalendarExportResult, type CalendarTarget } from './calendar-export';
import { confirmedCalendarDraft, sameCalendarSource, type CalendarSource } from './calendar-source';

export type CalendarConnection = {
  renewalVerified?: boolean; target: CalendarTarget; email: string; expiresAt: number; adapter: CalendarExportAdapter & Partial<CalendarReadAdapter>; persist?(): Promise<void>; renew?(): Promise<CalendarConnection>;
};

/** Connection state exposes no token fields to UI or app sessions. */
export function createCalendarConnection(deps: {
  authorize(): Promise<CalendarConnection | null>; now?(): number;
  restore?(): Promise<CalendarConnection | null>; clear?(): Promise<void>;
}) {
  let connection: CalendarConnection | null = null;
  let epoch = 0;
  let suspended = false;
  let connecting: Promise<boolean> | null = null;
  let exporter: ReturnType<typeof createCalendarExporter> | null = null;
  const listeners = new Set<() => void>();
  let message = '';
  let reauthRequired = false;
  let renewing: { epoch: number; promise: Promise<void> } | null = null;
  const notify = () => { for (const listener of listeners) listener(); };
  const now = deps.now || Date.now;
  const pending = new Map<string, Promise<CalendarExportResult>>();
  const invalidate = () => {
    epoch++; connection = null; exporter = null; message = ''; reauthRequired = false;
    restoring = null; connecting = null; pending.clear();
  };
  const disconnect = () => {
    invalidate();
    void deps.clear?.().catch(() => { message = '연결 정보 삭제에 실패했습니다. 다시 연결 해제를 눌러주세요.'; notify(); });
    notify();
  };
  async function ensureReady(force = false) {
    if (suspended) throw Error('CALENDAR_OWNER_CHANGED');
    if (connecting) throw Error('CALENDAR_CONNECTING');
    const active = connection;
    const captured = epoch;
    if (!active) throw Error('CALENDAR_NOT_CONNECTED');
    if (reauthRequired) throw Error('CALENDAR_REAUTH_REQUIRED');
    if (renewing?.epoch === captured) return renewing.promise;
    if (!force && now() < active.expiresAt) return;
    if (!active.renew) throw Error('CALENDAR_EXPIRED');
    const current = () => captured === epoch && connection === active;
    const promise = active.renew().then(async next => {
      if (!current()) throw Error('CALENDAR_OWNER_CHANGED');
      if (next.target.accountId !== active.target.accountId || next.target.calendarId !== active.target.calendarId
        || next.expiresAt <= now()) throw Error('CALENDAR_REAUTH_REQUIRED');
      await next.persist?.();
      if (!current()) throw Error('CALENDAR_OWNER_CHANGED');
      connection = next; exporter = createCalendarExporter(next.adapter); message = '';
    }).catch(error => {
      if (current()) {
        if ((error as Error).message === 'CALENDAR_REAUTH_REQUIRED') {
          reauthRequired = true;
          void deps.clear?.().catch(() => undefined);
          message = 'Google 연결 권한을 다시 확인해야 합니다. 설정에서 다시 연결해주세요.';
        } else message = 'Google 연결을 갱신하지 못했습니다. 연결 정보는 유지됩니다. 다시 시도해주세요.';
      }
      throw error;
    }).finally(() => { if (renewing?.promise === promise) renewing = null; notify(); });
    renewing = { epoch: captured, promise }; notify();
    return promise;
  }
  let restoring: Promise<void> | null = null;
  return {
    disconnect,
    suspend() { suspended = true; invalidate(); notify(); },
    resume() { suspended = false; },
    ensureReady,
    restore() {
      if (suspended) return Promise.resolve();
      if (restoring) return restoring;
      if (connection || connecting || !deps.restore) return Promise.resolve();
      const captured = epoch;
      const work = deps.restore().then(next => {
        if (captured !== epoch || connection || connecting) return;
        if (next) { connection = next; exporter = createCalendarExporter(next.adapter); }
      }).catch(() => {
        if (captured === epoch) message = '저장된 연결을 확인하지 못했습니다. 다시 시도해주세요.';
      }).finally(() => { if (restoring === work) restoring = null; notify(); });
      restoring = work; notify();
      return work;
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    status() { return { generation: epoch, connecting: !!connecting || !!restoring || renewing?.epoch === epoch, message }; },
    info() { return connection ? { email: connection.email, target: { ...connection.target }, expiresAt: connection.expiresAt, renewalVerified: connection.renewalVerified, expired: reauthRequired || (!connection.renew && now() >= connection.expiresAt) } : null; },
    connect() {
      if (suspended) return Promise.resolve(false);
      if (connecting) return connecting;
      // Invalidate in-flight work without deleting a usable saved grant.
      // Replace it only after authorization and persistence both succeed.
      epoch++; message = '';
      const captured = epoch;
      const work = deps.authorize().then(async next => {
        if (captured !== epoch) return false;
        if (!next || next.expiresAt <= now()) { message = '연결을 취소했거나 연결 시간이 만료되었습니다.'; return false; }
        await next.persist?.();
        if (captured !== epoch) return false;
        connection = next; reauthRequired = false; exporter = createCalendarExporter(next.adapter); message = '연결되었습니다.'; return true;
      }).catch(error => {
        if (captured === epoch) message = (error as Error).message === 'CALENDAR_AUTH_DENIED'
          ? '구글 권한 동의가 거부되었습니다.' :
          /^CALENDAR_AUTH_EXCHANGE_\d{3}$/.test((error as Error).message) ? '인증 결과 교환에 실패했습니다. 다시 연결해주세요.' :
          /^CALENDAR_AUTH_IDENTITY_\d{3}$/.test((error as Error).message) ? '연결한 구글 계정을 확인하지 못했습니다.' :
          (error as Error).message === 'CALENDAR_REFRESH_NOT_CONFIGURED' ? '자동 연결 유지 서버 설정이 필요합니다.' :
          (error as Error).message === 'CALENDAR_AUTH_REFRESH_MISSING' ? '연결 유지 권한을 받지 못했습니다. 다시 동의해주세요.' :
          (error as Error).message === 'CALENDAR_AUTH_TOKEN_MISSING' ? '구글 캘린더 접근 정보를 받지 못했습니다. 권한 동의를 확인해주세요.' : '연결을 완료하지 못했습니다. 다시 연결해주세요.';
        throw error;
      }).finally(() => { if (connecting === work) connecting = null; notify(); });
      connecting = work; notify();
      return work;
    },
    async readEvents(range: CalendarReadRange, callerCurrent = () => true) {
      const captured = epoch;
      for (let attempt = 0; attempt < 2; attempt++) {
        await ensureReady(attempt > 0);
        if (!callerCurrent() || captured !== epoch) throw Error('CALENDAR_OWNER_CHANGED');
        const active = connection;
        if (!active?.adapter.list) throw Error('CALENDAR_NOT_CONNECTED');
        const current = () => callerCurrent() && captured === epoch && connection === active;
        try {
          const result = await active.adapter.list(range, current);
          if (!current()) throw Error('CALENDAR_OWNER_CHANGED');
          return result;
        } catch (error) {
          if ((error as Error).message !== 'CALENDAR_EXPIRED' || attempt || !current()) throw error;
        }
      }
      throw Error('CALENDAR_EXPIRED');
    },
    send(source: CalendarSource, end: string, read: () => Promise<CalendarSource>, current: () => boolean) {
      const key = source.scheduleId;
      if (pending.has(key)) return pending.get(key)!;
      const captured = epoch;
      let active = connection;
      let send = exporter;
      const isCurrent = () => current() && captured === epoch && connection === active && !!active && now() < active.expiresAt;
      const run = async (): Promise<CalendarExportResult> => {
        try {
          await ensureReady();
          if (captured !== epoch || !current()) return { state: 'cancelled', message: '계정이 변경되었거나 등록을 취소했습니다.' };
          active = connection; send = exporter;
        } catch (error) {
          const code = (error as Error).message;
          return { state: code === 'CALENDAR_EXPIRED' || code === 'CALENDAR_REAUTH_REQUIRED' ? 'expired' : 'blocked',
            message: code === 'CALENDAR_EXPIRED' || code === 'CALENDAR_REAUTH_REQUIRED' ? 'Google 권한을 다시 확인해주세요.' : '연결을 갱신하지 못했습니다. 잠시 후 다시 시도해주세요.' };
        }
        if (!active || !send) return { state: 'blocked', message: 'Google 캘린더 계정을 먼저 연결해주세요.' };
        if (now() >= active.expiresAt) return { state: 'blocked', message: 'Google 연결 갱신 후 다시 시도해주세요.' };
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
      const work = run().then(async result => {
        if (result.state !== 'expired' || !connection?.renew || captured !== epoch || reauthRequired || !current()) return result;
        try { await ensureReady(true); } catch { return { state: 'blocked' as const, message: 'Google 연결을 갱신하지 못했습니다. 다시 시도해주세요.' }; }
        return run();
      }).finally(() => { if (pending.get(key) === work) pending.delete(key); }); pending.set(key, work); return work;
    },
  };
}

