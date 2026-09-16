import type { Config, Context } from "@netlify/functions";
import { createSupabaseDataCoreRestClient } from "../shared/data-core/supabase-rest-client.mjs";
import { publicSupabaseAuthConfig } from "../shared/platform/supabase-auth-config.mjs";
import { createSupabaseWorkspaceContextResolver } from "../shared/platform/supabase-workspace-context.mjs";
import { sendWebPush } from "../shared/web-push.mjs";
import { vapidConfigFromEnv } from "../shared/vapid-config.mjs";

function json(status:number, body:Record<string,unknown>){
  return new Response(JSON.stringify(body), { status, headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"} });
}

function bearerToken(req:Request){
  const match=/^Bearer\s+(.+)$/i.exec(String(req.headers.get("authorization") || ""));
  return match ? match[1].trim() : "";
}

function pushConfig(){
  return vapidConfigFromEnv((name:string)=>Netlify.env.get(name));
}

function uuid(value:any){
  const text=String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : "";
}

export default async (req:Request, _context:Context) => {
  if(req.method!=="POST") return json(405,{error:"METHOD_NOT_ALLOWED"});
  const accessToken=bearerToken(req);
  if(!accessToken) return json(401,{error:"LOGIN_REQUIRED",message:"로그인 후 서버 알림을 테스트할 수 있습니다."});

  const push=pushConfig();
  if(!push.configured) return json(503,{error:"WEB_PUSH_NOT_CONFIGURED",message:"서버 알림 설정이 아직 준비되지 않았습니다."});
  const supabase=publicSupabaseAuthConfig((name:string)=>Netlify.env.get(name));
  if(!supabase.configured) return json(503,{error:"SUPABASE_NOT_CONFIGURED",message:"계정 저장소 설정이 아직 준비되지 않았습니다."});

  try{
    const body=await req.json().catch(()=>({}));
    const subscriptionId=uuid(body?.subscriptionId);
    if(!subscriptionId) return json(400,{error:"SUBSCRIPTION_ID_REQUIRED",message:"테스트할 기기 구독을 확인하지 못했습니다."});

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
    if(rows.length!==1) return json(404,{error:"SUBSCRIPTION_NOT_FOUND",message:"이 기기의 활성 알림 구독을 찾지 못했습니다."});

    const row:any=rows[0];
    try{
      await sendWebPush({
        subscription:{endpoint:row.endpoint,p256dh:row.p256dh,auth:row.auth_secret},
        payload:JSON.stringify({
          title:"업무수첩 서버 알림 테스트",
          body:"앱을 닫아도 서버에서 알림을 보낼 수 있습니다.",
          tag:"worklog-server-push-test",
          url:"/",
        }),
        vapidPublicKey:push.publicKey,
        vapidPrivateKey:push.privateKey,
        vapidSubject:push.subject,
      });
      const now=new Date().toISOString();
      await client.update("push_subscriptions",{last_success_at:now,last_failure_at:null,last_failure_status:null,last_failure_code:null,updated_at:now},{id:`eq.${subscriptionId}`,user_id:`eq.${workspace.userId}`});
      return json(200,{ok:true,delivered:true});
    }catch(error:any){
      const now=new Date().toISOString();
      const status=Number(error?.status || 0);
      const code=String(error?.code || "WEB_PUSH_DELIVERY_FAILED").slice(0,80);
      const patch:any={last_failure_at:now,last_failure_status:status || null,last_failure_code:code,updated_at:now};
      if(error?.expired) patch.disabled_at=now;
      await client.update("push_subscriptions",patch,{id:`eq.${subscriptionId}`,user_id:`eq.${workspace.userId}`}).catch(()=>{});
      return json(error?.expired ? 410 : 502,{error:code,message:error?.expired ? "이 기기의 기존 알림 구독이 만료되었습니다. 다시 연결해주세요." : "서버에서 알림을 전송하지 못했습니다.",pushStatus:status || undefined});
    }
  }catch(error:any){
    return json(400,{error:String(error?.code || "PUSH_TEST_FAILED"),message:String(error?.message || "서버 알림 테스트에 실패했습니다.")});
  }
};

export const config:Config={path:"/api/push-test"};
