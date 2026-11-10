import type { PersonalCalendarEvent } from '../calendar/personal-calendar-api';
import { repeatOccurrences, type RepeatingWork } from './recurrence-model';
export function recurringCalendarEvents(works: RepeatingWork[], month: string): PersonalCalendarEvent[] {
  const last = new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);
  return works.flatMap(work=>repeatOccurrences(work,month+'-01',last).filter(row=>row.status==='pending').map(row=>({
    id:`repeat:${work.workRecordId}:${row.key}`,source:'personal',title:`↻ ${row.title}`,starts_at:`${row.dueDate}T${row.time||'00:00'}:00+09:00`,ends_at:null,all_day:!row.time,location:null,description:'반복 업무 · 업무 상세에서 수정',status:'confirmed',updated_at:String(work.version),editable:false,
  })));
}
