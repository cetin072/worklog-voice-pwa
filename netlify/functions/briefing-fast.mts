import type { Config, Context } from "@netlify/functions";
import { briefingV2Counts, classifyBriefingTasks } from "../shared/briefing-v2.mjs";
import { createSupabaseDataCoreRestClient } from "../shared/data-core/supabase-rest-client.mjs";
import { createSupabaseWorkspaceContextResolver } from "../shared/platform/supabase-workspace-context.mjs";
import { createWorklogDataCoreBriefingReader } from "../shared/worklog-data-core-briefing-reader.mjs";
import { createWorklogDataCoreBriefingSource } from "../shared/worklog-data-core-briefing-source.mjs";
import { createWorklogDataCoreScheduleReader } from "../shared/worklog-data-core-schedule-reader.mjs";

function json(status:number,body:Record<string,unknown>){
  return new Response(JSON.stringify(body),{
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store"
    }
  });
}

function seoulDate(input:Date|string|number=new Date()){
  const date=input instanceof Date ? input : new Date(input);
  if(Number.isNaN(date.getTime())) return "";
  const parts=new Intl.DateTimeFormat("en-CA",{
    timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(date);
  const get=(type:string)=>parts.find(part=>part.type===type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function seoulIsoNow(){
  const shifted=new Date(Date.now()+9*60*60*1000).toISOString();
  return `${shifted.slice(0,-1)}+09:00`;
}

function dataCoreBriefingReadEnabled(){
  return String(Netlify.env.get("WORKLOG_DATA_CORE_BRIEFING_ENABLED") || "").trim().toLowerCase()==="true";
}

function dataCoreBriefingMutationEnabled(){
  return String(Netlify.env.get("WORKLOG_DATA_CORE_BRIEFING_MUTATION_ENABLED") || "").trim().toLowerCase()==="true";
}

function dataCoreScheduleBriefingEnabled(){
  return String(Netlify.env.get("WORKLOG_DATA_CORE_SCHEDULE_BRIEFING_ENABLED") || "").trim().toLowerCase()==="true";
}

function bearerToken(req:Request){
  const match=/^Bearer\s+(.+)$/i.exec(String(req.headers.get("authorization") || ""));
  return match ? match[1].trim() : "";
}

function rpcUnavailable(error:any){
  return error?.code==="SUPABASE_DATA_CORE_RPC_FAILED"
    && /get_my_briefing_source|schema cache|function/i.test(String(error?.message || ""));
}

async function loadLegacyDataCore({supabaseUrl,publishableKey,accessToken,client}:{supabaseUrl:string,publishableKey:string,accessToken:string,client:any}){
  const resolver=createSupabaseWorkspaceContextResolver({supabaseUrl,publishableKey});
  const workspaceContext=await resolver.resolve(accessToken);
  const tasks=await createWorklogDataCoreBriefingReader({client}).listOpenTasks(workspaceContext);
  const today=seoulDate();
  const schedules=dataCoreScheduleBriefingEnabled()
    ? await createWorklogDataCoreScheduleReader({client}).listForBriefing(workspaceContext,today)
    : {today:[],upcoming:[],total:0};
  return {today,tasks,schedules,fastPath:false};
}

async function loadFastDataCore({supabaseUrl,publishableKey,accessToken,client}:{supabaseUrl:string,publishableKey:string,accessToken:string,client:any}){
  const reader=createWorklogDataCoreBriefingSource({client});
  try{
    const source=await reader.load();
    return {today:source.today,tasks:source.tasks,schedules:source.schedules,fastPath:true};
  }catch(error:any){
    if(rpcUnavailable(error)){
      return loadLegacyDataCore({supabaseUrl,publishableKey,accessToken,client});
    }
    if(error?.code==="WORKLOG_DATA_CORE_BRIEFING_WORKSPACE_MISSING"){
      const resolver=createSupabaseWorkspaceContextResolver({supabaseUrl,publishableKey});
      await resolver.resolve(accessToken);
      const source=await reader.load();
      return {today:source.today,tasks:source.tasks,schedules:source.schedules,fastPath:true};
    }
    throw error;
  }
}

export default async (req:Request,_context:Context)=>{
  if(req.method!=="GET") return json(405,{error:"허용되지 않은 요청입니다."});
  if(!dataCoreBriefingReadEnabled()) return json(404,{error:"Data Core 브리핑이 활성화되지 않았습니다."});

  const accessToken=bearerToken(req);
  if(!accessToken) return json(401,{error:"Platform 로그인이 필요합니다."});

  const supabaseUrl=Netlify.env.get("SUPABASE_URL");
  const publishableKey=Netlify.env.get("SUPABASE_PUBLISHABLE_KEY");
  if(!supabaseUrl || !publishableKey) return json(503,{error:"Data Core 브리핑 설정이 아직 준비되지 않았습니다."});

  try{
    const client=createSupabaseDataCoreRestClient({supabaseUrl,publishableKey,accessToken});
    const source=await loadFastDataCore({supabaseUrl,publishableKey,accessToken,client});
    const structure=classifyBriefingTasks(source.tasks,source.today);
    const schedules=dataCoreScheduleBriefingEnabled()
      ? source.schedules
      : {today:[],upcoming:[],total:0};
    return json(200,{
      ok:true,
      ready:true,
      generatedAt:seoulIsoNow(),
      today:source.today,
      mode:"data_core",
      truncated:false,
      canUpdate:dataCoreBriefingMutationEnabled(),
      scheduleEnabled:dataCoreScheduleBriefingEnabled(),
      schedules,
      counts:briefingV2Counts(structure),
      structure,
      fastPath:source.fastPath
    });
  }catch(error:any){
    if(error?.code==="SUPABASE_WORKSPACE_AUTH_FAILED" || error?.code==="SUPABASE_WORKSPACE_ACCESS_TOKEN_REQUIRED"){
      return json(401,{error:"Platform 로그인 세션을 확인하지 못했습니다. 다시 로그인한 뒤 브리핑을 열어주세요."});
    }
    console.error("Data Core briefing fast path error",String(error?.code || "unknown"),String(error?.message || "unknown").slice(0,160));
    return json(502,{error:"Data Core 업무 상황을 빠르게 불러오지 못했습니다."});
  }
};

export const config:Config={
  path:"/api/briefing-fast",
  method:["GET"]
};
