import type { Config, Context } from "@netlify/functions";
import { briefingSnapshotFilter, enrichBriefingStatuses, pageBelongsToDataSource, parseBriefingSnapshot, preservedQuickBriefingPeriod, quickTaskRank, sanitizeBriefingSnapshot } from "../shared/core-logic.mjs";

const NOTION_VERSION = "2026-03-11";
const DEFAULT_DATA_SOURCE_ID = "e345d19d-504f-4466-815a-912b1d6b9a3a";
const BRIEFING_PROJECT = "SYSTEM_DAILY_BRIEFING";
const BRIEFING_TITLE = "[시스템] 현재 일일 브리핑";
const EXCLUDED_PROJECTS = new Set(["SYSTEM_DAILY_BRIEFING","SYSTEM_SPLIT_SOURCE","SYSTEM_TEST"]);
const ALLOWED_STATUSES = new Set(["완료","진행중","대기","확인필요"]);
const SCHEDULED_PERIODS = new Set(["오전 8시","오후 12시 30분","오후 6시"]);

function json(status:number, body:Record<string,unknown>){
  return new Response(JSON.stringify(body), {
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
  return arr.map((v:any)=>v?.plain_text || v?.text?.content || "").join("").trim();
}

function titleValue(value:any){
  const arr=value?.title;
  if(!Array.isArray(arr)) return "";
  return arr.map((v:any)=>v?.plain_text || v?.text?.content || "").join("").trim();
}

function selectValue(value:any){
  return String(value?.select?.name || value?.status?.name || "").trim();
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
  if((req.headers.get("x-worklog-key")||"")!==accessKey) return {error:"개인 접근키가 올바르지 않습니다.",status:401 as const};
  return {token,dataSourceId,mode:"owner" as const};
}

function notionHeaders(token:string){
  return {
    "Authorization":`Bearer ${token}`,
    "Content-Type":"application/json",
    "Notion-Version":NOTION_VERSION
  };
}

function validPageId(value:string){
  return /^[0-9a-f]{32}$/i.test(value) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
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

function dayDiff(from:string,to:string){
  const a=Date.parse(`${from}T00:00:00Z`);
  const b=Date.parse(`${to}T00:00:00Z`);
  return Math.round((b-a)/(24*60*60*1000));
}

function dueDateKey(raw:string){
  if(!raw) return "";
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed=new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : seoulDate(parsed);
}

function mmdd(key:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(key)) return "";
  const [,month,day]=key.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function cleanSnapshotValue(value:any,max=120){
  return String(value || "")
    .replace(/[|\r\n]+/g," ")
    .replace(/\s+/g," ")
    .trim()
    .slice(0,max);
}

function richTextProperty(value:string){
  const chunks=value.match(/[\s\S]{1,1900}/g) || [""];
  return {rich_text:chunks.map(content=>({type:"text",text:{content}}))};
}

async function querySnapshot(token:string,dataSourceId:string){
  const res=await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`,{
    method:"POST",
    headers:notionHeaders(token),
    body:JSON.stringify({
      page_size:10,
      filter:briefingSnapshotFilter(BRIEFING_PROJECT,BRIEFING_TITLE),
      sorts:[{timestamp:"last_edited_time",direction:"descending"}]
    })
  });

  const data:any=await res.json().catch(()=>({}));
  if(!res.ok){
    console.error("Notion briefing snapshot query error",res.status,String(data?.code || data?.message || "").slice(0,300));
    const error:any=new Error(`NOTION_${res.status}`);
    error.status=res.status;
    throw error;
  }

  return Array.isArray(data.results) ? data.results[0] : null;
}

async function queryQuickTasks(token:string,dataSourceId:string){
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
      console.error("Notion quick briefing query error",res.status,String(data?.code || data?.message || "").slice(0,300));
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

async function getPageStatus(token:string,pageId:string,expectedDataSourceId=""){
  const res=await fetch(`https://api.notion.com/v1/pages/${pageId}`,{
    method:"GET",
    headers:notionHeaders(token)
  });
  const data:any=await res.json().catch(()=>({}));
  if(!res.ok){
    const error:any=new Error(`NOTION_${res.status}`);
    error.status=res.status;
    throw error;
  }

  const parentId=String(data?.parent?.data_source_id || data?.parent?.database_id || "");
  if(!pageBelongsToDataSource(parentId,expectedDataSourceId)){
    const error:any=new Error("NOTION_PAGE_OUTSIDE_DATA_SOURCE");
    error.status=403;
    throw error;
  }
  return selectValue(data?.properties?.["상태"]);
}

async function setPageStatus(token:string,pageId:string,status:string){
  const res=await fetch(`https://api.notion.com/v1/pages/${pageId}`,{
    method:"PATCH",
    headers:notionHeaders(token),
    body:JSON.stringify({properties:{"상태":{select:{name:status}}}})
  });
  const data:any=await res.json().catch(()=>({}));
  if(!res.ok){
    console.error("Notion briefing status update error",res.status,String(data?.code || data?.message || "").slice(0,300));
    const error:any=new Error(`NOTION_${res.status}`);
    error.status=res.status;
    throw error;
  }
  return data;
}

async function writeSnapshot(token:string,pageId:string,rawText:string){
  const res=await fetch(`https://api.notion.com/v1/pages/${pageId}`,{
    method:"PATCH",
    headers:notionHeaders(token),
    body:JSON.stringify({properties:{"내용":richTextProperty(rawText)}})
  });
  const data:any=await res.json().catch(()=>({}));
  if(!res.ok){
    console.error("Notion quick briefing write error",res.status,String(data?.code || data?.message || "").slice(0,300));
    const error:any=new Error(`NOTION_${res.status}`);
    error.status=res.status;
    throw error;
  }
  return data;
}

function sanitizeSnapshot(raw:any){
  return sanitizeBriefingSnapshot(raw);
}

async function enrichTopStatuses(token:string,dataSourceId:string,briefing:any){
  const items=Array.isArray(briefing.top) ? briefing.top : [];
  briefing.top=await enrichBriefingStatuses(items,pageId=>getPageStatus(token,pageId,dataSourceId),validPageId);
  return briefing;
}

function parseStoredSnapshot(rawText:string){
  return parseBriefingSnapshot(rawText);
}

function quickRank(task:any,today:string){
  return quickTaskRank(task,today,dayDiff);
}

function quickNote(task:any,today:string){
  if(task.dueKey){
    const diff=dayDiff(today,task.dueKey);
    if(diff<0) return `기한 경과 · ${mmdd(task.dueKey)}`;
    if(diff===0) return `오늘 기한 · ${mmdd(task.dueKey)}`;
    if(diff===1) return `내일 기한 · ${mmdd(task.dueKey)}`;
    return `기한 ${mmdd(task.dueKey)}`;
  }
  if(task.status==="확인필요") return "확인 필요 상태";
  if(task.status==="진행중") return "진행중 업무";
  if(task.status==="대기") return "대기 업무";
  return "미완료 업무";
}

async function buildQuickSnapshot(token:string,dataSourceId:string,period="빠른 업데이트"){
  const query=await queryQuickTasks(token,dataSourceId);
  const rawTasks=query.results;
  const today=seoulDate();
  const tasks=rawTasks.map((page:any)=>{
    const props=page?.properties || {};
    const dueRaw=String(props?.["기한"]?.date?.start || "");
    return {
      pageId:String(page?.id || ""),
      title:titleValue(props?.["업무명"]),
      institution:selectValue(props?.["기관"]),
      status:selectValue(props?.["상태"]),
      project:textValue(props?.["프로젝트"]),
      dueKey:dueDateKey(dueRaw),
      editedAt:String(page?.last_edited_time || "")
    };
  }).filter((task:any)=>task.title && ALLOWED_STATUSES.has(task.status) && task.status!=="완료" && !EXCLUDED_PROJECTS.has(task.project));

  tasks.sort((a:any,b:any)=>{
    const rankDiff=quickRank(a,today)-quickRank(b,today);
    if(rankDiff) return rankDiff;
    if(a.dueKey && b.dueKey && a.dueKey!==b.dueKey) return a.dueKey.localeCompare(b.dueKey);
    return b.editedAt.localeCompare(a.editedAt);
  });

  const top=tasks.slice(0,10);
  const todayItems=tasks.filter((task:any)=>task.dueKey===today).slice(0,3);
  const upcoming=tasks.filter((task:any)=>{
    if(!task.dueKey) return false;
    const diff=dayDiff(today,task.dueKey);
    return diff>0 && diff<=14;
  }).slice(0,3);

  const countLabel=query.truncated ? `${tasks.length}건 이상` : `${tasks.length}건`;
  const lines=[
    "BRIEFING_V1",
    `generatedAt=${seoulIsoNow()}`,
    `period=${cleanSnapshotValue(period,30) || "빠른 업데이트"}`,
    `meta=Notion 미완료 업무 ${countLabel} 기준 · AI 재정리 없이 즉시 반영`
  ];

  top.forEach((task:any)=>{
    lines.push(`TOP|${cleanSnapshotValue(task.title,80)}|${cleanSnapshotValue(quickNote(task,today),60)}|${cleanSnapshotValue(task.institution || "기타",30)}|${cleanSnapshotValue(task.pageId,40)}`);
  });
  todayItems.forEach((task:any)=>lines.push(`TODAY|${cleanSnapshotValue(task.title,80)}|${mmdd(task.dueKey)}`));
  upcoming.forEach((task:any)=>lines.push(`UPCOMING|${cleanSnapshotValue(task.title,80)}|${mmdd(task.dueKey)}`));

  return {raw:lines.join("\n"),taskCount:tasks.length,truncated:query.truncated};
}

function preservedQuickPeriod(snapshotPage:any){
  const raw=textValue(snapshotPage?.properties?.["내용"]);
  const current=parseStoredSnapshot(raw || "");
  const generatedDate=seoulDate(String(current?.generatedAt || ""));
  const currentPeriod=String(current?.period || "");
  return preservedQuickBriefingPeriod({generatedDate,period:currentPeriod},seoulDate(),SCHEDULED_PERIODS);
}

export default async (req:Request, _context:Context) => {
  if(req.method!=="GET" && req.method!=="POST") return json(405,{error:"허용되지 않은 요청입니다."});

  const connection:any=resolveConnection(req);
  if(connection.error) return json(connection.status || 400,{error:connection.error});
  const {token,dataSourceId,mode}=connection;
  const includeStatuses=new URL(req.url).searchParams.get("statuses")!=="0";

  if(req.method==="POST"){
    let body:any;
    try{ body=await req.json(); }
    catch{ return json(400,{error:"요청 형식이 올바르지 않습니다."}); }

    if(String(body.action || "")==="quick_update"){
      try{
        const snapshotPage=await querySnapshot(token,dataSourceId);
        if(!snapshotPage?.id) return json(409,{error:"브리핑 시스템 기록을 찾을 수 없습니다."});
        const quick=await buildQuickSnapshot(token,dataSourceId,preservedQuickPeriod(snapshotPage));
        await writeSnapshot(token,snapshotPage.id,quick.raw);
        const parsed=parseStoredSnapshot(quick.raw);
        const briefing=await enrichTopStatuses(token,dataSourceId,sanitizeSnapshot(parsed));
        return json(200,{ok:true,ready:true,briefing,mode,quick:true,taskCount:quick.taskCount,truncated:quick.truncated});
      }catch(error:any){
        if(mode==="personal" && (error?.status===401 || error?.status===404)){
          return json(401,{error:"개인 Notion 연결이 만료되었거나 DB를 찾을 수 없습니다. 다시 연결해주세요."});
        }
        console.error(error);
        return json(502,{error:"빠른 브리핑 업데이트에 실패했습니다."});
      }
    }

    const pageId=String(body.pageId || "").trim();
    const nextStatus=String(body.status || "").trim();
    if(!validPageId(pageId)) return json(400,{error:"업무 연결 정보가 올바르지 않습니다."});
    if(!ALLOWED_STATUSES.has(nextStatus)) return json(400,{error:"변경할 상태가 올바르지 않습니다."});

    try{
      const previousStatus=await getPageStatus(token,pageId,dataSourceId);
      if(!ALLOWED_STATUSES.has(previousStatus)) return json(409,{error:"현재 업무 상태를 확인할 수 없습니다."});
      if(previousStatus!==nextStatus) await setPageStatus(token,pageId,nextStatus);
      return json(200,{ok:true,pageId,previousStatus,status:nextStatus,mode});
    }catch(error:any){
      if(error?.status===403) return json(403,{error:"이 업무는 현재 연결된 업무 DB에 속하지 않습니다."});
      if(mode==="personal" && (error?.status===401 || error?.status===404)){
        return json(401,{error:"개인 Notion 연결이 만료되었거나 업무를 찾을 수 없습니다. 다시 연결해주세요."});
      }
      console.error(error);
      return json(502,{error:"Notion 업무 상태를 변경하지 못했습니다."});
    }
  }

  try{
    const page=await querySnapshot(token,dataSourceId);
    if(!page) return json(200,{ok:true,ready:false,message:"아직 생성된 일일 브리핑이 없습니다.",mode});

    const rawText=textValue(page?.properties?.["내용"]);
    if(!rawText || rawText==="브리핑 준비 중"){
      return json(200,{ok:true,ready:false,message:mode==="personal" ? "ChatGPT 브리핑 설정 전입니다. 녹음 저장은 바로 사용할 수 있습니다." : "첫 예약 브리핑 생성 전입니다.",mode});
    }

    const parsed=parseStoredSnapshot(rawText);
    if(!parsed){
      console.error("Invalid briefing snapshot",rawText.slice(0,300));
      return json(502,{error:"저장된 일일 브리핑 형식이 올바르지 않습니다."});
    }

    let briefing=sanitizeSnapshot(parsed);
    if(includeStatuses) briefing=await enrichTopStatuses(token,dataSourceId,briefing);
    return json(200,{ok:true,ready:true,briefing,mode});
  }catch(error:any){
    if(mode==="personal" && (error?.status===401 || error?.status===404)){
      return json(401,{error:"개인 Notion 연결이 만료되었거나 DB를 찾을 수 없습니다. 다시 연결해주세요."});
    }
    console.error(error);
    return json(502,{error:"최신 일일 브리핑을 불러오지 못했습니다."});
  }
};

export const config:Config={
  path:"/api/briefing",
  method:["GET","POST"]
};
