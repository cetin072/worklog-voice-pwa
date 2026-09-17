import type { Config } from '@netlify/functions';
import { buildScheduleReminderPayload } from '../shared/schedule-reminder-content.mjs';
import { notificationSchedulerConfig,createNotificationSchedulerClient } from '../shared/notification-scheduler.mjs';
import { vapidConfigFromEnv } from '../shared/vapid-config.mjs';
import { sendWebPush } from '../shared/web-push.mjs';
function appOrigin(subject:string){try{const u=new URL(String(Netlify.env.get('URL')||subject||''));return u.protocol==='https:'?u.origin:'';}catch{return '';}}
export default async()=>{
 const scheduler=notificationSchedulerConfig((n:string)=>Netlify.env.get(n)),vapid=vapidConfigFromEnv((n:string)=>Netlify.env.get(n)),origin=appOrigin(vapid.subject); if(!scheduler.configured||!vapid.configured||!origin){console.error('Schedule advance Push skipped: configuration incomplete');return;}
 const client=createNotificationSchedulerClient(scheduler); let rows:any[]=[]; try{rows=[...(await client.claimScheduleAdvance({appOrigin:origin}))];}catch(e:any){console.error('Schedule advance claim failed',String(e?.code||'unknown'));return;}
 let sent=0,failed=0; for(const row of rows){const payload=buildScheduleReminderPayload(row);if(!payload){try{await client.finish({deliveryId:row.deliveryId,success:false,code:'EMPTY_SCHEDULE'});}catch{} failed++;continue;}try{await sendWebPush({subscription:{endpoint:row.endpoint,p256dh:row.p256dh,auth:row.auth},payload:JSON.stringify(payload),vapidPublicKey:vapid.publicKey,vapidPrivateKey:vapid.privateKey,vapidSubject:vapid.subject});await client.finish({deliveryId:row.deliveryId,success:true});sent++;}catch(e:any){failed++;const status=Number.isInteger(Number(e?.status))?Number(e.status):null;try{await client.finish({deliveryId:row.deliveryId,success:false,status,code:String(e?.code||'WEB_PUSH_UNKNOWN').slice(0,80)});}catch{}}}
 console.log('Schedule advance Push complete',JSON.stringify({claimed:rows.length,sent,failed}));
};
// Every 5 minutes; claim RPC only returns the due 30-minute reminder window and dedupes per schedule/subscription.
export const config:Config={schedule:'*/5 * * * *'};
