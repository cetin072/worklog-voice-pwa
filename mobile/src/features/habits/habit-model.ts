import { shiftDay } from '../home/home-calendar-model';
export type Habit = {id:string;name:string;frequency:'daily'|'weekdays'|'weekly-target';weekdays:number[];target:number;start_date:string;archived_at:string|null;version:number};
export type HabitCheck = {habit_id:string;day:string;checked:boolean;version:number};
export type HabitDraft = Pick<Habit,'name'|'frequency'|'weekdays'|'target'|'start_date'>;
export function weekStart(today:string) {return shiftDay(today,-((new Date(today+'T12:00:00Z').getUTCDay()+6)%7));}
export function habitDue(habit:Habit,today:string) {
 return !habit.archived_at && today>=habit.start_date && (habit.frequency!=='weekdays'||habit.weekdays.includes((new Date(today+'T12:00:00Z').getUTCDay()+6)%7+1));
}
export function habitProgress(habit:Habit,checks:HabitCheck[],today:string) {
 const monday=weekStart(today),sunday=shiftDay(monday,6);
 const count=new Set(checks.filter(c=>c.habit_id===habit.id&&c.checked&&c.day>=monday&&c.day<=sunday).map(c=>c.day)).size;
 let target=habit.frequency==='weekly-target'?habit.target:0;
 if(habit.frequency!=='weekly-target')for(let i=0;i<7;i++)if(habitDue(habit,shiftDay(monday,i)))target++;
 return {count,target,todayChecked:checks.some(c=>c.habit_id===habit.id&&c.day===today&&c.checked)};
}
export function validateHabit(draft:HabitDraft):HabitDraft {
 const name=draft.name.trim(),date=Date.parse(draft.start_date+'T12:00:00Z');
 if(!name||name.length>60||!/^\d{4}-\d{2}-\d{2}$/.test(draft.start_date)||!Number.isFinite(date)||new Date(date).toISOString().slice(0,10)!==draft.start_date)throw Error('습관 이름과 시작일을 확인해주세요.');
 if(!['daily','weekdays','weekly-target'].includes(draft.frequency)||!Number.isInteger(draft.target)||draft.target<1||draft.target>7||draft.weekdays.some(d=>!Number.isInteger(d)||d<1||d>7)||(draft.frequency==='weekdays'&&!draft.weekdays.length))throw Error('요일과 주간 목표를 확인해주세요.');
 return {...draft,name,weekdays:[...new Set(draft.weekdays)].sort()};
}
