import type { BriefingTask } from '@/src/platform/worklog-api';
import { shiftDay } from '../home/home-calendar-model';
import { repeatHistory, type RepeatingWork, type RepeatOccurrence } from './recurrence-model';

/** Adapter only: computed rows use Home's existing renderer; never persist a shadow WorkRecord. */
export function recurringHomeProjection(structure: Record<'today'|'overdue'|'upcoming'|'undated', BriefingTask[]>, works: RepeatingWork[], today: string) {
  const ids=new Set(works.map(w=>w.workRecordId));
  const result=Object.fromEntries(Object.entries(structure).map(([bucket,rows])=>[bucket,rows.filter(r=>!r.pageId||!ids.has(r.pageId))])) as typeof structure;
  const occurrences=new Map<string,RepeatOccurrence>();
  for (const work of works) {
    let upcomingShown = false;
    for (const row of repeatHistory(work,shiftDay(today,90))) {
      if(row.status!=='pending')continue;
      const bucket=row.dueDate<today?'overdue':row.dueDate===today?'today':'upcoming';
      // repeatHistory is ordered by due date. Home shows one future occurrence per work.
      if (bucket === 'upcoming') {
        if (upcomingShown) continue;
        upcomingShown = true;
      }
      const id=`repeat:${work.workRecordId}:${row.key}`;occurrences.set(id,row);
      (result[bucket] ||= []).push({pageId:id,title:row.title,dueKey:row.dueDate,dueTime:row.time,status:'진행중',reason:bucket});
    }
  }
  for(const [bucket,rows] of Object.entries(result))if(bucket!=='undated')rows.sort((a,b)=>bucket==='overdue'?(b.dueKey||'').localeCompare(a.dueKey||''):(a.dueKey||'').localeCompare(b.dueKey||''));
  return {structure:result,occurrences};
}
