import type { Config, Context } from "@netlify/functions";
import { briefingV2Counts, classifyBriefingTasks } from "../shared/briefing-v2.mjs";
import { createSupabaseDataCoreRestClient } from "../shared/data-core/supabase-rest-client.mjs";
import { createSupabaseWorkspaceContextResolver } from "../shared/platform/supabase-workspace-context.mjs";
import { createWorklogDataCoreBriefingReader } from "../shared/worklog-data-core-briefing-reader.mjs";
import { createWorklogDataCoreBriefingStatus } from "../shared/worklog-data-core-briefing-status.mjs";

const NOTION_VERSION="2026-03-11";
const DEFAULT_DATA_SOURCE_ID="e345d19d-504f-4466-815a-912b1d6b9a3a";

function json(status:number,body:Record<string,unknown>){
  return new Response(JSON.stringify(body),{
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store"
    }
  });
}

function textValue(value:any){
  const arr=value?.rich_text;
  if(!Array.isArray(arr)) return "";
  return arr.map((item:any)=>item?.plain_text || item?.text?.content || "").join("").trim();
}

function titleValue(value:any){
  const arr=value?.title;
  if(!Array.isArray(arr)) return "";
  return arr.map((item:any)=>item?.plain_text || item?.text?.content || "").join("").trim();
}

function selectValue(value:any){
  return String(value?.select?.name || value?.status?.name || "").trim();
}

function dueDateKey(raw:string){
  if(!raw) return "";
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed=new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : seoulDate(parsed);
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

function bearerToken(req:Request){
  const match=/^Bearer\s+(.+)$/i.exec(String(req.headers.get("authorization") || ""));
  return match ? match[1].trim() : "";
}

function personalConnection(req:Request){
  const token=(req.headers.get("x-notion-token") || "").trim();
  const dataSourceId=(req.headers.get("x-notion-data-source-id") || "").trim();
  if(!token && !dataSourceId) return null;
  if(!token || !dataSourceId) return {error:"개인 Notion 연결 정보가 불완전합니다."};
  if(token.length>300 || dataSourceId.length>100) return {error:"개인 Notion 연결 정보 형식이 올바르지 않습니다."};
  return {token,dataSourceId,mode:"personal" as const};
}

function resolveConnection(req:Request){
  const personal=personalConnection(req);
  if(personal && "error" in personal) return {error:personal.error,status:400 as const};
  if(personal) return personal;

  const token=Netlify.env.get("NOTION_TOKEN");
  const accessKey=Netlify.env.get("APP_ACCESS_KEY");
  const dataSourceId=Netlify.env.get("NOTION_DATA_SOURCE_ID") || DEFAULT_DATA_SOURCE_ID;
  if(!token) return {error:"NOTION_TOKEN이 설정되지 않았습니다.",status:500 as const};
  if(!accessKey) return {error:"APP_ACCESS_KEY가 설정되지 않았습니다.",status:500 as const};
  if((req.headers.get("x-worklog-key") || "")!==accessKey) return {error:"개인 접근키가 올바르지 않습니다.",status:401 as const};
  return {token,dataSourceId,mode:"owner" as const};
}

function notionHeaders(token:string){
  return {
    "Authorization":`Bearer ${token}`,
    "Content-Type":"application/json",
    "Notion-Version":NOTION_VERSION
  };
}

async function queryOpenTasks(token:string,dataSourceId:string){
  const results:any[]=[];
  let cursor="";
  let hasMore=true;

  while(hasMore && results.length<500){
    const body:any={
      page_size:100,
      filter:{property:"상태",select:{does_not_equal:"완료"}},
      sorts:[{timestamp:"last_edited_time",direction:"descending"}]
    };
    if(cursor) body.start_cursor=cursor;

    const res=await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`,{
      method:"POST",
      headers:notionHeaders(token),
      body:JSON.stringify(body)
    });
    const data:any=await res.json().catch(()=>({}));
    if(!res.ok){
      console.error("Notion briefing v2 query error",res.status,String(data?.code || data?.message || "").slice(0,300));
      const error:any=new Error(`NOTION_${res.status}`);
      error.status=res.status;
      throw error;
    }

    if(Array.isArray(data.results)) results.push(...data.results);
    hasMore=Boolean(data.has_more && data.next_cursor);
    cursor=hasMore ? String(data.next_cursor) : "";
  }

  return {results:results.slice(0,500),truncated:hasMore};
}

function taskFromPage(page:any){
  const props=page?.properties || {};
  const dueRaw=String(props?.["기한"]?.date?.start || "");
  return {
    pageId:String(page?.id || ""),
    title:titleValue(props?.["업무명"]).slice(0,160),
    institution:selectValue(props?.["기관"]).slice(0,60),
    status:selectValue(props?.["상태"]),
    project:textValue(props?.["프로젝트"]).slice(0,80),
    dueKey:dueDateKey(dueRaw),
    followUp:textValue(props?.["후속조치"]).slice(0,240),
    editedAt:String(page?.last_edited_time || "")
  };
}

export default async (req:Request,_context:Context)=>{
  if(!["GET","POST"].includes(req.method)) return json(405,{error:"허용되지 않은 요청입니다."});

  const accessToken=bearerToken(req);
  if(req.method==="POST"){
    if(!(dataCoreBriefingReadEnabled() && dataCoreBriefingMutationEnabled() && accessToken)) return json(405,{error:"Data Core 브리핑 상태 변경이 활성화되지 않았습니다."});
    const supabaseUrl=Netlify.env.get("SUPABASE_URL");
    const publishableKey=Netlify.env.get("SUPABASE_PUBLISHABLE_KEY");
    if(!supabaseUrl || !publishableKey) return json(503,{error:"Data Core 브리핑 설정이 아직 준비되지 않았습니다."});
    let body:any;
    try{ body=await req.json(); }catch{ return json(400,{error:"요청 형식이 올바르지 않습니다."}); }
    try{
      const resolver=createSupabaseWorkspaceContextResolver({supabaseUrl,publishableKey});
      const workspaceContext=await resolver.resolve(accessToken);
      const statusWriter=createWorklogDataCoreBriefingStatus({client:createSupabaseDataCoreRestClient({supabaseUrl,publishableKey,accessToken})});
      const result=await statusWriter.updateStatus({recordId:body.recordId,status:body.status},workspaceContext);
      return json(200,{ok:true,mode:"data_core",...result});
    }catch(error:any){
      if(error?.code==="SUPABASE_WORKSPACE_AUTH_FAILED" || error?.code==="SUPABASE_WORKSPACE_ACCESS_TOKEN_REQUIRED") return json(401,{error:"Platform 로그인 세션을 확인하지 못했습니다. 다시 로그인한 뒤 상태를 변경해주세요."});
      if(error?.code==="WORKLOG_DATA_CORE_STATUS_RECORD_ID_INVALID" || error?.code==="WORKLOG_DATA_CORE_STATUS_INVALID") return json(400,{error:error.message});
      if(error?.code==="WORKLOG_DATA_CORE_STATUS_NOT_FOUND_OR_FORBIDDEN") return json(404,{error:error.message});
      console.error("Data Core briefing status error",String(error?.code || "unknown"),String(error?.message || "unknown").slice(0,160));
      return json(502,{error:"Data Core 업무 상태를 변경하지 못했습니다."});
    }
  }

  if(dataCoreBriefingReadEnabled() && accessToken){
    const supabaseUrl=Netlify.env.get("SUPABASE_URL");
    const publishableKey=Netlify.env.get("SUPABASE_PUBLISHABLE_KEY");
    if(!supabaseUrl || !publishableKey) return json(503,{error:"Data Core 브리핑 설정이 아직 준비되지 않았습니다."});
    try{
      const resolver=createSupabaseWorkspaceContextResolver({supabaseUrl,publishableKey});
      const workspaceContext=await resolver.resolve(accessToken);
      const reader=createWorklogDataCoreBriefingReader({client:createSupabaseDataCoreRestClient({supabaseUrl,publishableKey,accessToken})});
      const tasks=await reader.listOpenTasks(workspaceContext);
      const today=seoulDate();
      const structure=classifyBriefingTasks(tasks,today);
      return json(200,{ok:true,ready:true,generatedAt:seoulIsoNow(),today,mode:"data_core",truncated:false,canUpdate:dataCoreBriefingMutationEnabled(),counts:briefingV2Counts(structure),structure});
    }catch(error:any){
      if(error?.code==="SUPABASE_WORKSPACE_AUTH_FAILED" || error?.code==="SUPABASE_WORKSPACE_ACCESS_TOKEN_REQUIRED") return json(401,{error:"Platform 로그인 세션을 확인하지 못했습니다. 다시 로그인한 뒤 브리핑을 열어주세요."});
      console.error("Data Core briefing v2 error",String(error?.code || "unknown"),String(error?.message || "unknown").slice(0,160));
      return json(502,{error:"Data Core 업무 상황을 불러오지 못했습니다."});
    }
  }

  const connection:any=resolveConnection(req);
  if(connection.error) return json(connection.status || 400,{error:connection.error});
  const {token,dataSourceId,mode}=connection;

  try{
    const query=await queryOpenTasks(token,dataSourceId);
    const today=seoulDate();
    const structure=classifyBriefingTasks(query.results.map(taskFromPage),today);
    return json(200,{
      ok:true,
      ready:true,
      generatedAt:seoulIsoNow(),
      today,
      mode,
      truncated:query.truncated,
      counts:briefingV2Counts(structure),
      structure
    });
  }catch(error:any){
    if(mode==="personal" && (error?.status===401 || error?.status===404)){
      return json(401,{error:"개인 Notion 연결이 만료되었거나 DB를 찾을 수 없습니다. 다시 연결해주세요."});
    }
    console.error(error);
    return json(502,{error:"브리핑 2.0 업무 상황을 불러오지 못했습니다."});
  }
};

export const config:Config={
  path:"/api/briefing-v2",
  method:["GET","POST"]
};
