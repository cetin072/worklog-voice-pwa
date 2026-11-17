import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useCalendarConnection } from './use-calendar-connection';
import { calendarReadRange, calendarReadMessage, type CalendarReadResult } from './calendar-read';

/** Screen-owned, in-memory projection. Keys suppress old account/range results
 * immediately on render, before effect cleanup. No DB or notification writes.
 */
export function useExternalCalendar(months: string, revision = 0) {
  const connection = useCalendarConnection();
  const info = connection?.info();
  const generation = connection?.status().generation;
  const [reload, setReload] = useState(0);
  const key = `${months}:${revision}:${reload}:${generation}`;
  const [result, setResult] = useState<{ connection: typeof connection; key: string; data?: CalendarReadResult; error?: string } | null>(null);
  const available = !!info && !info.expired;
  const refresh = () => setReload(value => value + 1);
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    const timer = info && !info.expired ? setTimeout(refresh, Math.max(1, info.expiresAt - Date.now() + 1)) : undefined;
    return () => { sub.remove(); if (timer) clearTimeout(timer); };
  }, [connection, generation, info?.expiresAt, info?.expired]);
  useEffect(() => {
    let alive = true;
    if (!connection || !available) return;
    void Promise.resolve().then(() => connection.readEvents(calendarReadRange(months), () => alive))
      .then(data => { if (alive) setResult({ connection, key, data }); })
      .catch(error => { if (alive) setResult({ connection, key, error: calendarReadMessage(error) }); });
    return () => { alive = false; };
  }, [connection, available, key, months]);
  const current = available && result?.connection === connection && result.key === key ? result : null;
  return { events: current?.data?.events || [], limited: current?.data?.limited || false,
    loading: available && !current, connected: !!info, restoring: !!connection?.status().connecting,
    error: info?.expired ? calendarReadMessage(Error('CALENDAR_EXPIRED')) : current?.error || '', refresh };
}
