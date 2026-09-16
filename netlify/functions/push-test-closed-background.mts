import type { Config, Context } from "@netlify/functions";
import { createSupabaseDataCoreRestClient } from "../shared/data-core/supabase-rest-client.mjs";
import { publicSupabaseAuthConfig } from "../shared/platform/supabase-auth-config.mjs";
import { createSupabaseWorkspaceContextResolver } from "../shared/platform/supabase-workspace-context.mjs";
import { sendWebPush } from "../shared/web-push.mjs";

function bearerToken(req:Request){
  const match=/^Bearer\s+(.+)$/i.exec(String(req.headers.get("authorization") || ""));
  return match ? match[1].trim() : "";
}

function uuid(value:any){
  const text=String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : "";
}

function pushConfig(){
  const publicKey=String(Netlify.env.get("WEB_PUSH_VAPID_PUBLIC_KEY") || "").trim();
  const privateKey=String(Netlify.env.get("WEB_PUSH_VAPID_PRIVATE_KEY") || "").trim();
  const subject=String(Netlify.env.get("WEB_PUSH_VAPID_SUBJECT") || "").trim();
  return { configured:Boolean(publicKey && privateKey && subject), publicKey, privateKey, subject };
}

export default async (req:Request, _context:Context) => {
  if(req.method!=="POST") return;
  const accessToken=bearerToken(req);
  if(!accessToken) return;

  const body=await req.json().catch(()=>({}));
  const subscriptionId=uuid(body?.subscriptionId);
  if(!subscriptionId) return;

  const push=pushConfig();
  const supabase=publicSupabaseAuthConfig((name:string)=>Netlify.env.get(name));
  if(!push.configured || !supabase.configured) return;

  try{
    const resolver=createSupabaseWorkspaceContextResolver({supabaseUrl:supabase.supabaseUrl,publishableKey:supabase.publishableKey});
    const workspace=await resolver.resolve(accessToken);
    const client=createSupabaseDataCoreRestClient({supabaseUrl:supabase.supabaseUrl,publishableKey:supabase.publishableKey,accessToken});
    const rows=await client.select("push_subscriptions",{
      id:`eq.${subscriptionId}`,
      workspace_id:`eq.${workspace.workspaceId}`,
      user_id:`eq.${workspace.userId}`,
      disabled_at:"is.null",
      select:"id,endpoint,p256dh,auth_secret",
      limit:"1",
    });
    if(rows.length!==1) return;

    await new Promise((resolve)=>setTimeout(resolve,8000));
    const row:any=rows[0];
    try{
      await sendWebPush({
        subscription:{endpoint:row.endpoint,p256dh:row.p256dh,auth:row.auth_secret},
        payload:JSON.stringify({
          title:"업무수첩 서버 Push 확인",
          body:"앱을 닫은 상태에서도 서버 알림이 도착했습니다.",
          tag:"worklog-server-push-closed-test",
          url:"/",
        }),
        vapidPublicKey:push.publicKey,
        vapidPrivateKey:push.privateKey,
        vapidSubject:push.subject,
      });
      const now=new Date().toISOString();
      await client.update("push_subscriptions",{last_success_at:now,last_failure_at:null,updated_at:now},{id:`eq.${subscriptionId}`,user_id:`eq.${workspace.userId}`});
    }catch(error:any){
      const now=new Date().toISOString();
      const patch:any={last_failure_at:now,updated_at:now};
      if(error?.expired) patch.disabled_at=now;
      await client.update("push_subscriptions",patch,{id:`eq.${subscriptionId}`,user_id:`eq.${workspace.userId}`}).catch(()=>{});
    }
  }catch{}
};

export const config:Config={path:"/api/push-test-closed",method:"POST",background:true};
