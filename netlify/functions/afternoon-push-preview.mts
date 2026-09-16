import type { Config, Context } from "@netlify/functions";
import { createSupabaseDataCoreRestClient } from "../shared/data-core/supabase-rest-client.mjs";
import { buildAfternoonPushPayload } from "../shared/afternoon-push-content.mjs";
import { buildMorningPushPreviewState } from "../shared/morning-push-preview-source.mjs";
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

function requestOrigin(req:Request){
  try{
    const url=new URL(req.url);
    return url.protocol==="https:" ? url.origin : "";
  }catch{
    return "";
  }
}

function pushConfig(){
  const privateKey=Netlify.env.get("WEB_PUSH_VAPID_PRIVATE_KEY");
  return vapidConfigFromEnv((name:string)=>name==="WEB_PUSH_VAPID_PRIVATE_KEY" ? privateKey : Netlify.env.get(name));
}

function uuid(value:any){
  const text=String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : "";
}

export default async (req:Request, _context:Context) => {
  if(req.method!=="POST") return json(405,{error:"METHOD_NOT_ALLOWED"});
  const accessToken=bearerToken(req);
  if(!accessToken) return json(401,{error:"LOGIN_REQUIRED",message:"로그인 후 오후 업무 알림을 테스트할 수 있습니다."});
  const origin=requestOrigin(req);
  if(!origin) return json(400,{error:"APP_ORIGIN_INVALID",message:"앱 주소를 확인하지 못했습니다."});

  const push=pushConfig();
  if(!push.configured) return json(503,{error:"WEB_PUSH_NOT_CONFIGURED",message:"서버 알림 설정이 아직 준비되지 않았습니다."});
  const supabase=publicSupabaseAuthConfig((name:string)=>Netlify.env.get(name));
  if(!supabase.configured) return json(503,{error:"SUPABASE_NOT_CONFIGURED",message:"업무 저장소 설정이 아직 준비되지 않았습니다."});

  try{
    const body=await req.json().catch(()=>({}));
    const subscriptionId=uuid(body?.subscriptionId);
    if(!subscriptionId) return json(400,{error:"SUBSCRIPTION_ID_REQUIRED",message:"테스트할 기기 구독을 확인하지 못했습니다."});

    const resolver=createSupabaseWorkspaceContextResolver({supabaseUrl:supabase.supabaseUrl,publishableKey:supabase.publishableKey});
    const workspace=await resolver.resolve(accessToken);
    const client=createSupabaseDataCoreRestClient({supabaseUrl:supabase.supabaseUrl,publishableKey:supabase.publishableKey,accessToken});

    const [sourceResult, preferences, subscriptions]=await Promise.all([
      client.rpc("get_my_briefing_source",{}),
      client.select("notification_preferences",{
        select:"morning_detail_enabled",
        workspace_id:`eq.${workspace.workspaceId}`,
        user_id:`eq.${workspace.userId}`,
        limit:"1",
      }),
      client.select("push_subscriptions",{
        id:`eq.${subscriptionId}`,
        workspace_id:`eq.${workspace.workspaceId}`,
        user_id:`eq.${workspace.userId}`,
        app_origin:`eq.${origin}`,
        disabled_at:"is.null",
        select:"id,endpoint,p256dh,auth_secret",
        limit:"1",
      }),
    ]);

    const sourceRow:any=Array.isArray(sourceResult) ? sourceResult[0] : sourceResult;
    if(String(sourceRow?.workspace_id || "")!==String(workspace.workspaceId || "")){
      return json(409,{error:"BRIEFING_WORKSPACE_MISMATCH",message:"현재 업무공간의 브리핑 데이터를 확인하지 못했습니다."});
    }
    if(subscriptions.length!==1) return json(404,{error:"SUBSCRIPTION_NOT_FOUND",message:"이 기기의 활성 알림 구독을 찾지 못했습니다."});

    const detailEnabled=(preferences[0] as any)?.morning_detail_enabled !== false;
    const preview=buildMorningPushPreviewState(sourceRow,{detailEnabled});
    const payload=buildAfternoonPushPayload(preview);
    if(!payload){
      return json(200,{ok:true,delivered:false,empty:true,message:"오늘 남아 있는 할 일이나 지난 업무가 없습니다."});
    }

    const row:any=subscriptions[0];
    try{
      await sendWebPush({
        subscription:{endpoint:row.endpoint,p256dh:row.p256dh,auth:row.auth_secret},
        payload:JSON.stringify(payload),
        vapidPublicKey:push.publicKey,
        vapidPrivateKey:push.privateKey,
        vapidSubject:push.subject,
      });
      const now=new Date().toISOString();
      await client.update("push_subscriptions",{last_success_at:now,last_failure_at:null,last_failure_status:null,last_failure_code:null,updated_at:now},{id:`eq.${subscriptionId}`,user_id:`eq.${workspace.userId}`});
      return json(200,{ok:true,delivered:true,title:payload.title,body:payload.body});
    }catch(error:any){
      const now=new Date().toISOString();
      const status=Number(error?.status || 0);
      const code=String(error?.code || "WEB_PUSH_DELIVERY_FAILED").slice(0,80);
      const patch:any={last_failure_at:now,last_failure_status:status || null,last_failure_code:code,updated_at:now};
      if(error?.expired) patch.disabled_at=now;
      await client.update("push_subscriptions",patch,{id:`eq.${subscriptionId}`,user_id:`eq.${workspace.userId}`}).catch(()=>{});
      return json(error?.expired ? 410 : 502,{error:code,message:error?.expired ? "이 기기의 기존 알림 구독이 만료되었습니다. 자동으로 다시 연결해 재시도합니다." : "오후 업무 알림을 전송하지 못했습니다.",pushStatus:status || undefined});
    }
  }catch(error:any){
    const code=String(error?.code || "AFTERNOON_PUSH_PREVIEW_FAILED");
    if(code==="SUPABASE_WORKSPACE_AUTH_FAILED" || code==="SUPABASE_WORKSPACE_ACCESS_TOKEN_REQUIRED"){
      return json(401,{error:"LOGIN_REQUIRED",message:"로그인 세션을 다시 확인해주세요."});
    }
    console.error("Afternoon Push preview failed",code,String(error?.message || "unknown").slice(0,160));
    return json(400,{error:code,message:String(error?.message || "오후 업무 알림 테스트에 실패했습니다.")});
  }
};

export const config:Config={path:"/api/afternoon-push-preview",method:["POST"]};
