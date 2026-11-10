import { shiftDay } from '../home/home-calendar-model';
import { repeatOccurrences, type RepeatingWork } from './recurrence-model';
export const REPEAT_REMINDER_OWNER='worklog.repeat.v1';
export function planRepeatReminders(works:RepeatingWork[],owner:string,today:string,now:number) {
 return works.flatMap(work=>repeatOccurrences(work,today,shiftDay(today,30)).filter(r=>r.status==='pending'&&r.time).map(r=>({
  identifier:`${REPEAT_REMINDER_OWNER}:${owner}:${work.workRecordId}:${r.key}`,
  at:`${r.dueDate}T${r.time}:00+09:00`,title:r.title,workRecordId:work.workRecordId,key:r.key,
 }))).filter(r=>Date.parse(r.at)>now).sort((a,b)=>a.at.localeCompare(b.at)||a.identifier.localeCompare(b.identifier)).slice(0,32);
}
