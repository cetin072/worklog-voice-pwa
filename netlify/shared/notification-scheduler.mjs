function schedulerError(code, message) { const error = new Error(message); error.code = code; return error; }
function httpsOrigin(value) { try { const url = new URL(String(value || '').trim()); return url.protocol === 'https:' ? url.origin : ''; } catch { return ''; } }
function text(value, max = 2048) { return String(value ?? '').trim().slice(0, max); }
function nonNegativeInteger(value) { const number = Number(value); return Number.isInteger(number) && number >= 0 ? number : null; }
function optionalHttpStatus(value) { if (value === null || value === undefined || value === '') return null; const number = Number(value); return Number.isInteger(number) && number >= 100 && number <= 599 ? number : null; }
function cleanClaim(row) {
  const deliveryId=text(row?.delivery_id,80), subscriptionId=text(row?.subscription_id,80), endpoint=text(row?.endpoint,2048), p256dh=text(row?.p256dh,512), auth=text(row?.auth_secret,256);
  const todayCount=nonNegativeInteger(row?.today_count), overdueCount=nonNegativeInteger(row?.overdue_count), scheduleCount=nonNegativeInteger(row?.schedule_count);
  const detailEnabled=row?.morning_detail_enabled!==false, primaryWorkTitle=text(row?.primary_work_title,200), primaryWorkBucket=text(row?.primary_work_bucket,20), primaryScheduleTitle=text(row?.primary_schedule_title,200), primaryScheduleTime=text(row?.primary_schedule_time,10);
  if(!deliveryId||!subscriptionId||!endpoint||!p256dh||!auth||todayCount===null||overdueCount===null||scheduleCount===null) throw schedulerError('NOTIFICATION_CLAIM_INVALID','알림 전송 대상 정보가 올바르지 않습니다.');
  if(primaryWorkBucket&&!["today","overdue"].includes(primaryWorkBucket)) throw schedulerError('NOTIFICATION_CLAIM_INVALID','알림 업무 분류가 올바르지 않습니다.');
  if(primaryScheduleTime&&primaryScheduleTime!=="종일"&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(primaryScheduleTime)) throw schedulerError('NOTIFICATION_CLAIM_INVALID','알림 일정 시각이 올바르지 않습니다.');
  return Object.freeze({deliveryId,subscriptionId,endpoint,p256dh,auth,todayCount,overdueCount,scheduleCount,detailEnabled,primaryWorkTitle,primaryWorkBucket,primaryScheduleTitle,primaryScheduleTime});
}
function cleanScheduleClaim(row){
  const deliveryId=text(row?.delivery_id,80),subscriptionId=text(row?.subscription_id,80),endpoint=text(row?.endpoint,2048),p256dh=text(row?.p256dh,512),auth=text(row?.auth_secret,256),scheduleId=text(row?.schedule_id,80),title=text(row?.schedule_title,200),startsAt=text(row?.schedule_starts_at,64);
  if(!deliveryId||!subscriptionId||!endpoint||!p256dh||!auth||!scheduleId||!title||!startsAt) throw schedulerError('NOTIFICATION_SCHEDULE_CLAIM_INVALID','일정 알림 전송 대상 정보가 올바르지 않습니다.');
  return Object.freeze({deliveryId,subscriptionId,endpoint,p256dh,auth,scheduleId,title,startsAt});
}
export function notificationSchedulerConfig(readEnv){ const read=typeof readEnv==='function'?readEnv:()=>undefined; const supabaseUrl=httpsOrigin(read('SUPABASE_URL')),publishableKey=text(read('SUPABASE_PUBLISHABLE_KEY'),500),schedulerSecret=text(read('NOTIFICATION_SCHEDULER_SECRET'),500); return Object.freeze({configured:Boolean(supabaseUrl&&publishableKey&&schedulerSecret.length>=32),supabaseUrl,publishableKey,schedulerSecret}); }
export function createNotificationSchedulerClient({supabaseUrl,publishableKey,schedulerSecret,fetchImpl=fetch}={}){
  const origin=httpsOrigin(supabaseUrl),key=text(publishableKey,500),secret=text(schedulerSecret,500); if(!origin||!key||secret.length<32) throw schedulerError('NOTIFICATION_SCHEDULER_CONFIG_INVALID','알림 스케줄러 설정이 올바르지 않습니다.'); if(typeof fetchImpl!=='function') throw schedulerError('NOTIFICATION_SCHEDULER_FETCH_REQUIRED','알림 스케줄러 fetch 구현이 필요합니다.');
  async function rpc(name,body){ const response=await fetchImpl(`${origin}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:key,'content-type':'application/json'},body:JSON.stringify(body)}); const data=await response.json().catch(()=>({})); if(!response.ok){const error=schedulerError('NOTIFICATION_SCHEDULER_RPC_FAILED',String(data?.message||data?.hint||`${name} 호출에 실패했습니다.`));error.status=response.status;throw error;} return data; }
  async function claim(functionName,appOrigin,localDate,label){const targetOrigin=httpsOrigin(appOrigin);if(!targetOrigin)throw schedulerError('NOTIFICATION_APP_ORIGIN_INVALID','알림 대상 앱 origin이 올바르지 않습니다.');const data=await rpc(functionName,{p_scheduler_secret:secret,p_app_origin:targetOrigin,p_local_date:localDate||null});if(!Array.isArray(data))throw schedulerError('NOTIFICATION_CLAIM_RESPONSE_INVALID',`${label} 알림 claim 결과가 올바르지 않습니다.`);return Object.freeze(data.map(cleanClaim));}
  return Object.freeze({
    async claimMorning({appOrigin,localDate=null}={}){return claim('claim_morning_notification_deliveries',appOrigin,localDate,'아침');},
    async claimAfternoon({appOrigin,localDate=null}={}){return claim('claim_afternoon_notification_deliveries',appOrigin,localDate,'오후');},
    async claimScheduleAdvance({appOrigin,now=null}={}){const targetOrigin=httpsOrigin(appOrigin);if(!targetOrigin)throw schedulerError('NOTIFICATION_APP_ORIGIN_INVALID','알림 대상 앱 origin이 올바르지 않습니다.');const data=await rpc('claim_schedule_advance_notification_deliveries',{p_scheduler_secret:secret,p_app_origin:targetOrigin,p_now:now||new Date().toISOString()});if(!Array.isArray(data))throw schedulerError('NOTIFICATION_CLAIM_RESPONSE_INVALID','일정 알림 claim 결과가 올바르지 않습니다.');return Object.freeze(data.map(cleanScheduleClaim));},
    async finish({deliveryId,success,status=null,code=null}={}){const id=text(deliveryId,80);if(!id||typeof success!=='boolean')throw schedulerError('NOTIFICATION_FINISH_INVALID','알림 완료 기록 값이 올바르지 않습니다.');const data=await rpc('finish_notification_delivery',{p_scheduler_secret:secret,p_delivery_id:id,p_success:success,p_status:optionalHttpStatus(status),p_code:code?text(code,80):null});if(data!==true)throw schedulerError('NOTIFICATION_FINISH_REJECTED','알림 완료 기록을 반영하지 못했습니다.');return true;}
  });
}
