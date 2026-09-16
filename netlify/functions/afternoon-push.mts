import type { Config } from "@netlify/functions";
import { buildAfternoonPushPayload } from "../shared/afternoon-push-content.mjs";
import { notificationSchedulerConfig, createNotificationSchedulerClient } from "../shared/notification-scheduler.mjs";
import { vapidConfigFromEnv } from "../shared/vapid-config.mjs";
import { sendWebPush } from "../shared/web-push.mjs";

function appOrigin(vapidSubject:string){
  try{
    const url=new URL(String(Netlify.env.get("URL") || vapidSubject || ""));
    return url.protocol==="https:" ? url.origin : "";
  }catch{
    return "";
  }
}

export default async ()=>{
  const scheduler=notificationSchedulerConfig((name:string)=>Netlify.env.get(name));
  const vapid=vapidConfigFromEnv((name:string)=>Netlify.env.get(name));
  const origin=appOrigin(vapid.subject);
  if(!scheduler.configured || !vapid.configured || !origin){
    console.error("Afternoon Push skipped: server configuration incomplete");
    return;
  }

  const client=createNotificationSchedulerClient(scheduler);
  let rows:any[]=[];
  try{
    rows=[...(await client.claimAfternoon({appOrigin:origin}))];
  }catch(error:any){
    console.error("Afternoon Push claim failed",String(error?.code || "unknown"),String(error?.message || "unknown").slice(0,120));
    return;
  }

  let sent=0;
  let failed=0;
  for(const row of rows){
    const payload=buildAfternoonPushPayload(row);
    if(!payload){
      try{ await client.finish({deliveryId:row.deliveryId,success:false,code:"EMPTY_INCOMPLETE"}); }catch{}
      failed+=1;
      continue;
    }
    try{
      await sendWebPush({
        subscription:{endpoint:row.endpoint,p256dh:row.p256dh,auth:row.auth},
        payload:JSON.stringify(payload),
        vapidPublicKey:vapid.publicKey,
        vapidPrivateKey:vapid.privateKey,
        vapidSubject:vapid.subject,
      });
      await client.finish({deliveryId:row.deliveryId,success:true});
      sent+=1;
    }catch(error:any){
      failed+=1;
      const status=Number.isInteger(Number(error?.status)) && Number(error.status)>=100 ? Number(error.status) : null;
      const code=String(error?.code || "WEB_PUSH_UNKNOWN").slice(0,80);
      try{
        await client.finish({deliveryId:row.deliveryId,success:false,status,code});
      }catch(finishError:any){
        console.error("Afternoon Push finish failed",String(finishError?.code || "unknown"));
      }
    }
  }
  console.log("Afternoon Push complete",JSON.stringify({claimed:rows.length,sent,failed}));
};

// Netlify cron is UTC. 07:30 UTC = 16:30 Asia/Seoul.
export const config:Config={schedule:"30 7 * * *"};
