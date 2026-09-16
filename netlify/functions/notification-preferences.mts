import type { Config, Context } from "@netlify/functions";
import { createSupabaseDataCoreRestClient } from "../shared/data-core/supabase-rest-client.mjs";
import { publicSupabaseAuthConfig } from "../shared/platform/supabase-auth-config.mjs";
import { createSupabaseWorkspaceContextResolver } from "../shared/platform/supabase-workspace-context.mjs";

function json(status:number, body:Record<string,unknown>){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
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

async function loadState(client:any, workspace:any, origin:string){
  const preferences=await client.select("notification_preferences",{
    select:"morning_enabled,morning_time,afternoon_enabled,afternoon_time,timezone,morning_detail_enabled",
    workspace_id:`eq.${workspace.workspaceId}`,
    user_id:`eq.${workspace.userId}`,
    limit:"1",
  });
  const subscriptions=await client.select("push_subscriptions",{
    select:"id",
    workspace_id:`eq.${workspace.workspaceId}`,
    user_id:`eq.${workspace.userId}`,
    app_origin:`eq.${origin}`,
    disabled_at:"is.null",
    limit:"1",
  });
  const pref=preferences[0] || {};
  return {
    morningEnabled:Boolean(pref.morning_enabled),
    afternoonEnabled:Boolean(pref.afternoon_enabled),
    detailEnabled:pref.morning_detail_enabled !== false,
    morningTime:"08:30",
    afternoonTime:"16:30",
    timezone:"Asia/Seoul",
    connected:subscriptions.length>0,
  };
}

export default async (req:Request,_context:Context)=>{
  if(!["GET","POST"].includes(req.method)) return json(405,{error:"METHOD_NOT_ALLOWED"});
  const accessToken=bearerToken(req);
  if(!accessToken) return json(401,{error:"LOGIN_REQUIRED",message:"로그인 후 알림 설정을 변경할 수 있습니다."});
  const origin=requestOrigin(req);
  if(!origin) return json(400,{error:"APP_ORIGIN_INVALID",message:"앱 주소를 확인하지 못했습니다."});

  const supabase=publicSupabaseAuthConfig((name:string)=>Netlify.env.get(name));
  if(!supabase.configured) return json(503,{error:"SUPABASE_NOT_CONFIGURED",message:"알림 설정 저장소가 아직 준비되지 않았습니다."});

  try{
    const resolver=createSupabaseWorkspaceContextResolver({supabaseUrl:supabase.supabaseUrl,publishableKey:supabase.publishableKey});
    const workspace=await resolver.resolve(accessToken);
    const client=createSupabaseDataCoreRestClient({supabaseUrl:supabase.supabaseUrl,publishableKey:supabase.publishableKey,accessToken});

    if(req.method==="GET") return json(200,{ok:true,...await loadState(client,workspace,origin)});

    const body=await req.json().catch(()=>({}));
    const hasMorning=Object.prototype.hasOwnProperty.call(body,"morningEnabled");
    const hasAfternoon=Object.prototype.hasOwnProperty.call(body,"afternoonEnabled");
    const hasDetail=Object.prototype.hasOwnProperty.call(body,"detailEnabled");
    if(hasMorning && typeof body?.morningEnabled!=="boolean") return json(400,{error:"MORNING_ENABLED_INVALID",message:"아침 알림 사용 여부를 확인해주세요."});
    if(hasAfternoon && typeof body?.afternoonEnabled!=="boolean") return json(400,{error:"AFTERNOON_ENABLED_INVALID",message:"오후 알림 사용 여부를 확인해주세요."});
    if(hasDetail && typeof body?.detailEnabled!=="boolean") return json(400,{error:"DETAIL_ENABLED_INVALID",message:"알림 내용 표시 설정을 확인해주세요."});
    if(!hasMorning && !hasAfternoon && !hasDetail) return json(400,{error:"NOTIFICATION_PREFERENCE_REQUIRED",message:"변경할 알림 설정을 확인해주세요."});

    const enablingPush=(hasMorning && body.morningEnabled) || (hasAfternoon && body.afternoonEnabled);
    if(enablingPush){
      const connected=await client.select("push_subscriptions",{
        select:"id",
        workspace_id:`eq.${workspace.workspaceId}`,
        user_id:`eq.${workspace.userId}`,
        app_origin:`eq.${origin}`,
        disabled_at:"is.null",
        limit:"1",
      });
      if(!connected.length) return json(409,{error:"PUSH_SUBSCRIPTION_REQUIRED",message:"먼저 이 기기를 서버 알림에 연결해주세요."});
    }

    const current=await loadState(client,workspace,origin);
    await client.upsert("notification_preferences",{
      workspace_id:workspace.workspaceId,
      user_id:workspace.userId,
      morning_enabled:hasMorning ? body.morningEnabled : current.morningEnabled,
      afternoon_enabled:hasAfternoon ? body.afternoonEnabled : current.afternoonEnabled,
      morning_detail_enabled:hasDetail ? body.detailEnabled : current.detailEnabled,
      morning_time:"08:30:00",
      afternoon_time:"16:30:00",
      timezone:"Asia/Seoul",
      updated_at:new Date().toISOString(),
    },["workspace_id","user_id"]);

    return json(200,{ok:true,...await loadState(client,workspace,origin)});
  }catch(error:any){
    const code=String(error?.code || "NOTIFICATION_PREFERENCES_FAILED");
    if(code==="SUPABASE_WORKSPACE_AUTH_FAILED" || code==="SUPABASE_WORKSPACE_ACCESS_TOKEN_REQUIRED"){
      return json(401,{error:"LOGIN_REQUIRED",message:"로그인 세션을 다시 확인해주세요."});
    }
    console.error("Notification preferences failed",code,String(error?.message || "unknown").slice(0,140));
    return json(502,{error:code,message:"알림 설정을 저장하지 못했습니다."});
  }
};

export const config:Config={path:"/api/notification-preferences",method:["GET","POST"]};
