import type { MobileBriefing, BriefingTask } from '@/src/platform/worklog-api';
type Bucket = 'today' | 'overdue' | 'upcoming' | 'undated';
/** Presentation only: never merge Task and Schedule identities or mutate source records. */
export function homeOverview(briefing: MobileBriefing) {
  const structure: Record<Bucket, BriefingTask[]> = { today: [], overdue: [], upcoming: [], undated: [] };
  const seen = new Set<string>();
  for (const bucket of ['today', 'overdue', 'upcoming', 'undated'] as const) {
    for (const task of briefing.structure?.[bucket] || []) {
      if (task.pageId && seen.has(task.pageId)) continue;
      if (task.pageId) seen.add(task.pageId);
      structure[bucket].push(task);
    }
  }
  // Attention-only results must remain actionable even when absent from dated buckets.
  for (const task of briefing.resurface || []) {
    if (task.pageId && seen.has(task.pageId)) continue;
    if (task.pageId) seen.add(task.pageId);
    const bucket = !task.dueKey ? 'undated' : task.dueKey === briefing.today ? 'today'
      : briefing.today && task.dueKey < briefing.today ? 'overdue' : 'upcoming';
    structure[bucket].push(task);
  }
  const total = Object.values(structure).reduce((n, tasks) => n + tasks.length, 0);
  const schedules = briefing.schedules?.today?.length || 0;
  const empty = total === 0 && !schedules && !briefing.schedules?.upcoming?.length && !briefing.notes?.length;
  return { structure, empty, summary: `표시된 업무: 오늘 ${structure.today.length} · 기한 지남 ${structure.overdue.length} · 다가오는 ${structure.upcoming.length} · 기한 없음 ${structure.undated.length} / 오늘 일정 ${schedules}개` };
}
