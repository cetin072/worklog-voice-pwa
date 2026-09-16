import type { Config, Context } from "@netlify/functions";
import { createSupabaseDataCoreRestClient } from "../shared/data-core/supabase-rest-client.mjs";
import { publicSupabaseAuthConfig } from "../shared/platform/supabase-auth-config.mjs";
import { createSupabaseWorkspaceContextResolver } from "../shared/platform/supabase-workspace-context.mjs";
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
  return vapidConfigFromEnv((name:string)=>Netlify.env.get(name));
}

function cleanSubscription(value:any){
  const endpoint=String(value?.endpoint || "").trim();
  const p256dh=String(value?.keys?.p256dh || value?.p256dh || "").trim();
  const auth=String(value?.keys?.auth || value?.auth || "").trim();
  let endpointUrl:URL;
  try { endpointUrl=new URL(endpoint); } catch { throw new Error("Push endpoint가 올바르지 않습니다."); }
  if(endpointUrl.protocol!=="https:" || endpoint.length>2048) throw new Error("Push endpoint가 올바르지 않습니다.");
  if(!/^[A-Za-z0-9_-]{80,100}$/.test(p256dh)) throw new Error("Push 공개키가 올바르지 않습니다.");
  if(!/^[A-Za-z0-9_-]{16,64}$/.test(auth)) throw new Error("Push 인증키가 올바르지 않습니다.");
  return { endpoint, p256dh, auth };
}

export default async (req:Request, _context:Context) => {
  if(req.method==="GET"){
    const config=pushConfig();
    return json(config.configured ? 200 : 503, {configured:config.configured,publicKey:config.publicKey});
  }
  if(req.method!=="POST") return json(405,{error:"METHOD_NOT_ALLOWED"});

  const accessToken=bearerToken(req);
  if(!accessToken) return json(401,{error:"LOGIN_REQUIRED",message:"로그인 후 서버 알림을 연결할 수 있습니다."});
  const origin=requestOrigin(req);
  if(!origin) return json(400,{error:"APP_ORIGIN_INVALID",message:"앱 주소를 확인하지 못했습니다."});

  const config=pushConfig();
  if(!config.configured) return json(503,{error:"WEB_PUSH_NOT_CONFIGURED",message:"서버 알림 설정이 아직 준비되지 않았습니다."});
  const supabase=publicSupabaseAuthConfig((name:string)=>Netlify.env.get(name));
  if(!supabase.configured) return json(503,{error:"SUPABASE_NOT_CONFIGURED",message:"계정 저장소 설정이 아직 준비되지 않았습니다."});

  try{
    const body=await req.json().catch(()=>({}));
    const subscription=cleanSubscription(body?.subscription || body);
    const resolver=createSupabaseWorkspaceContextResolver({supabaseUrl:supabase.supabaseUrl,publishableKey:supabase.publishableKey});
    const workspace=await resolver.resolve(accessToken);
    const client=createSupabaseDataCoreRestClient({supabaseUrl:supabase.supabaseUrl,publishableKey:supabase.publishableKey,accessToken});
    const now=new Date().toISOString();
    const row=await client.upsert("push_subscriptions",{
      workspace_id:workspace.workspaceId,
      user_id:workspace.userId,
      endpoint:subscription.endpoint,
      p256dh:subscription.p256dh,
      auth_secret:subscription.auth,
      app_origin:origin,
      user_agent:String(req.headers.get("user-agent") || "").slice(0,500),
      disabled_at:null,
      updated_at:now,
    },["user_id","endpoint"]);
    return json(200,{ok:true,subscriptionId:String(row.id || ""),appOrigin:origin});
  }catch(error:any){
    return json(400,{error:String(error?.code || "PUSH_SUBSCRIPTION_FAILED"),message:String(error?.message || "Push 구독 저장에 실패했습니다.")});
  }
};

export const config:Config={path:"/api/push-subscription"};
