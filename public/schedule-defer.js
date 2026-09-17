import { SCHEDULE_DEFER_PRESETS } from '/schedule-defer-presets.js';

async function apiJson(url, options={}){
  const response=await window.worklogAuthFetch(url,{...options,headers:{'content-type':'application/json',...(options.headers||{})}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data?.error||'일정을 미루지 못했습니다.');
  return data;
}
export function scheduleDeferOptions(){return SCHEDULE_DEFER_PRESETS;}
export async function deferSchedule({scheduleId,startsAt,preset,customStartsAt=null}){
  return apiJson('/api/schedule-defer',{method:'POST',body:JSON.stringify({scheduleId,startsAt,preset,customStartsAt})});
}
