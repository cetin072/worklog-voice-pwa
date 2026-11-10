import { cancelAllScheduleReminders } from '../schedule/local-notifications';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { RepeatingWork } from './recurrence-model';
import { planRepeatReminders, REPEAT_REMINDER_OWNER } from './recurrence-reminder-plan';
let queue:Promise<unknown>=Promise.resolve();
let generation=0;
const own=(r:Notifications.NotificationRequest)=>r.identifier.startsWith(REPEAT_REMINDER_OWNER+':')&&r.content.data?.owner===REPEAT_REMINDER_OWNER;
export function syncRepeatReminders(works:RepeatingWork[],owner:string,today:string,current:()=>boolean) {
 const token=generation;
 const run=queue.catch(()=>undefined).then(async()=>{
  if(Platform.OS==='web'||!current()||token!==generation)return;
  const sourceIds=[...new Set(works.flatMap(w=>w.state.revisions.flatMap(r=>r.sourceScheduleIds||[r.sourceScheduleId]).filter((id):id is string=>!!id)))];
  for(const id of sourceIds) { if(!current()||token!==generation)return; await cancelAllScheduleReminders(id,()=>current()&&token===generation); }
  const existing=(await Notifications.getAllScheduledNotificationsAsync()).filter(own);
  const permission=(await Notifications.getPermissionsAsync()).granted;
  const plan=permission?planRepeatReminders(works,owner,today,Date.now()):[];
  if(Platform.OS==='android')await Notifications.setNotificationChannelAsync('worklog-repeat',{name:'반복 업무',importance:Notifications.AndroidImportance.DEFAULT});
  for(const old of existing){if(!current()||token!==generation)return;const next=plan.find(p=>p.identifier===old.identifier);
   if(!next || old.content.data?.at!==next.at || old.content.title!==next.title)await Notifications.cancelScheduledNotificationAsync(old.identifier);
  }
  for(const next of plan){if(!current()||token!==generation)return;if(existing.some(old=>old.identifier===next.identifier&&old.content.data?.at===next.at&&old.content.title===next.title))continue;
   await Notifications.scheduleNotificationAsync({identifier:next.identifier,content:{title:next.title,body:'반복 업무 예정 시간입니다.',sound:'default',data:{owner:REPEAT_REMINDER_OWNER,userId:owner,target:'repeating-work',workRecordId:next.workRecordId,key:next.key,at:next.at}},trigger:{type:Notifications.SchedulableTriggerInputTypes.DATE,date:new Date(next.at),channelId:'worklog-repeat'}});
  }
  if(!permission&&works.some(w=>w.state.revisions.at(-1)?.time))throw Error('반복 업무는 저장됐습니다. 알림 권한은 기존 알림 설정에서 확인해주세요.');
 });queue=run;return run;
}
export function cancelAllRepeatReminders() {
 generation++;
 const run=queue.catch(()=>undefined).then(async()=>{if(Platform.OS==='web')return;for(const r of await Notifications.getAllScheduledNotificationsAsync())if(own(r))await Notifications.cancelScheduledNotificationAsync(r.identifier);});queue=run;return run;
}
