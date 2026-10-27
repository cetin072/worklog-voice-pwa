import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { MobileBriefing } from '@/src/platform/worklog-api';
import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import { findWorklogReminderLinks } from '../schedule/worklog-reminder-adapter';
import { readOwnedReminderSnapshots, reminderSessionEpoch, reminderSyncEpoch } from '../schedule/schedule-reminder-snapshot';
import { readScheduleReminderEvidenceBatch } from '../schedule/local-notifications';
import { reminderLabel } from './reminder-label';

const Labels = createContext<Record<string, string>>({});
export function useReminderStatus(id?: string, record = false) {
  return useContext(Labels)[`${record ? 'record' : 'schedule'}:${id}`] || '알림 확인 필요';
}
/** Context adds no layout node and resets evidence on navigation, edits, refresh and session changes. */
export function HomeReminderStatus({ client, briefing, scope, children }: {
  client: PlatformSupabaseClient | null; briefing: MobileBriefing | null; scope: string; children: ReactNode;
}) {
  const [result, setResult] = useState<{ scope: string; briefing: MobileBriefing | null; labels: Record<string, string> } | null>(null);
  useEffect(() => {
    let alive = true;
    const session = reminderSessionEpoch.capture();
    const sync = reminderSyncEpoch.capture();
    const current = () => alive && session() && sync();
    if (!client || !briefing) return;
    async function read() {
      const records = [...Object.values(briefing!.structure || {}).flat(), ...(briefing!.notes || [])]
        .map(row => row.pageId).filter((id): id is string => Boolean(id));
      // Failure of linkage must not suppress independently verifiable schedule rows.
      const links = await findWorklogReminderLinks(client!, records, current).catch(() => ({} as Record<string, string[]>));
      const ids = [...new Set([...(briefing!.schedules?.today || []), ...(briefing!.schedules?.upcoming || [])]
        .map(row => row.scheduleId).filter((id): id is string => Boolean(id)).concat(Object.values(links).flat()))];
      const snapshots = await readOwnedReminderSnapshots(client!, ids, current);
      const evidence = await readScheduleReminderEvidenceBatch(snapshots.rows.map(row => row.id));
      const labels: Record<string, string> = {};
      for (const row of snapshots.rows) {
        const displayed = [...(briefing!.schedules?.today || []), ...(briefing!.schedules?.upcoming || [])].find(item => item.scheduleId === row.id);
        const staleDisplay = displayed && (displayed.startsAt !== row.startsAt || displayed.title !== row.title);
        const staleTitle = evidence?.[row.id]?.stored.some(item => item.title !== row.title);
        labels[`schedule:${row.id}`] = staleDisplay || staleTitle ? '알림 확인 필요' : row.status === 'cancelled' ? '일정 취소됨 · 알림 확인 필요'
          : row.status === 'completed' ? '완료 일정 · 알림 확인 필요'
          : row.status !== 'confirmed' || row.allDay ? '알림 확인 필요'
          : reminderLabel(row.id, evidence?.[row.id] || null, Date.now(), row.startsAt);
      }
      for (const [record, linked] of Object.entries(links)) {
        if (linked.length === 1) labels[`record:${record}`] = labels[`schedule:${linked[0]}`] || '알림 확인 필요';
      }
      if (current()) setResult({ scope, briefing, labels });
    }
    void read().catch(() => { if (current()) setResult({ scope, briefing, labels: {} }); });
    return () => { alive = false; };
  }, [client, briefing, scope]);
  return <Labels.Provider value={result?.scope === scope && result.briefing === briefing ? result.labels : {}}>{children}</Labels.Provider>;
}
