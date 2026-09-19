import type { Config, Context } from "@netlify/functions";
import { pageBelongsToDataSource } from "../shared/core-logic.mjs";
import { createSupabaseDataCoreRestClient } from "../shared/data-core/supabase-rest-client.mjs";
import { normalizeWorklogDueInput, normalizeWorklogTitle, validWorklogPageId } from "../shared/worklog-edit.mjs";
import { createWorklogDataCoreEditor } from "../shared/worklog-data-core-editor.mjs";

const NOTION_VERSION="2026-03-11";
const DEFAULT_DATA_SOURCE_ID="e345d19d-504f-4466-815a-912b1d6b9a3a";

function json(status:number,body:Record<string,unknown>){
  return new Response(JSON.stringify(body),{
    status,
    headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
  });
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
  return {"Authorization":`Bearer ${token}`,"Content-Type":"application/json","Notion-Version":NOTION_VERSION};
}

function titleValue(value:any){
  const arr=value?.title;
  if(!Array.isArray(arr)) return "";
  return arr.map((item:any)=>item?.plain_text || item?.text?.content || "").join("").trim();
}

function titleProperty(value:string){
  return {title:[{type:"text",text:{content:value}}]};
}

function seoulDueFields(rawValue:any,hasTimeHint?:boolean){
  const raw=String(rawValue || "").trim();
  if(!raw) return {dueDate:"",dueTime:""};
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw)) return {dueDate:raw,dueTime:""};
  const parsed=new Date(raw);
  if(Number.isNaN(parsed.getTime())) return {dueDate:"",dueTime:""};
  const parts=new Intl.DateTimeFormat("en-CA",{
    timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false
  }).formatToParts(parsed);
  const get=(type:string)=>parts.find(part=>part.type===type)?.value || "";
  return {
    dueDate:`${get("year")}-${get("month")}-${get("day")}`,
    dueTime:hasTimeHint===false ? "" : `${get("hour")}:${get("minute")}`
  };
}

async function getVerifiedPage(token:string,pageId:string,dataSourceId:string){
  const res=await fetch(`https://api.notion.com/v1/pages/${pageId}`,{method:"GET",headers:notionHeaders(token)});
  const data:any=await res.json().catch(()=>({}));
  if(!res.ok){
    const error:any=new Error(`NOTION_${res.status}`);
    error.status=res.status;
    throw error;
  }
  const parentId=String(data?.parent?.data_source_id || data?.parent?.database_id || "");
  if(!pageBelongsToDataSource(parentId,dataSourceId)){
    const error:any=new Error("NOTION_PAGE_OUTSIDE_DATA_SOURCE");
    error.status=403;
    throw error;
  }
  return data;
}

async function updateNotionWorklog(token:string,pageId:string,title:string,dueStart:string|null|undefined){
  const properties:any={"업무명":titleProperty(title)};
  if(dueStart!==undefined) properties["기한"]={date:dueStart ? {start:dueStart} : null};
  const res=await fetch(`https://api.notion.com/v1/pages/${pageId}`,{
    method:"PATCH",headers:notionHeaders(token),body:JSON.stringify({properties})
  });
  const data:any=await res.json().catch(()=>({}));
  if(!res.ok){
    console.error("Notion worklog edit error",res.status,String(data?.code || data?.message || "").slice(0,300));
    const error:any=new Error(`NOTION_${res.status}`);
    error.status=res.status;
    throw error;
  }
  return data;
}

function dataCoreErrorResponse(error:any){
  if(error?.code==="WORKLOG_DATA_CORE_EDIT_AUTH_REQUIRED") return json(401,{error:"로그인 세션을 확인하지 못했습니다. 다시 로그인해주세요."});
  if(error?.code==="WORKLOG_DATA_CORE_EDIT_WORKSPACE_MISSING") return json(404,{error:"개인 업무공간을 찾지 못했습니다."});
  if(error?.code==="WORKLOG_DATA_CORE_EDIT_RECORD_ID_INVALID" || error?.code==="WORKLOG_DATA_CORE_EDIT_TITLE_INVALID" || error?.code==="WORKLOG_DATA_CORE_EDIT_DUE_INVALID" || error?.code==="WORKLOG_DATA_CORE_EDIT_ACTION_KIND_INVALID") return json(400,{error:error.message});
  if(error?.code==="WORKLOG_DATA_CORE_EDIT_ACTION_UNCLASSIFIED" || error?.code==="WORKLOG_DATA_CORE_EDIT_ACTION_SCHEDULE_LINKED") return json(409,{error:error.message});
  if(error?.code==="WORKLOG_DATA_CORE_POSTPONE_SCHEDULE_LINKED" || error?.code==="WORKLOG_DATA_CORE_POSTPONE_UNDO_UNAVAILABLE") return json(409,{error:error.message});
  if(error?.code==="WORKLOG_DATA_CORE_POSTPONE_DUE_REQUIRED" || error?.code==="WORKLOG_DATA_CORE_ATTENTION_MUST_BE_FUTURE") return json(400,{error:error.message});
  if(error?.code==="WORKLOG_DATA_CORE_EDIT_ACTION_CONVERSION_UNAVAILABLE") return json(503,{error:error.message});
  if(error?.code==="WORKLOG_DATA_CORE_EDIT_NOT_FOUND_OR_FORBIDDEN") return json(404,{error:error.message});
  console.error("Data Core worklog edit error",String(error?.code || "unknown"),String(error?.message || "unknown").slice(0,200));
  return json(502,{error:"업무를 수정하지 못했습니다. 잠시 후 다시 시도해주세요."});
}

export default async (req:Request,_context:Context)=>{
  if(req.method!=="POST") return json(405,{error:"허용되지 않은 요청입니다."});

  let body:any;
  try{ body=await req.json(); }
  catch{ return json(400,{error:"요청 형식이 올바르지 않습니다."}); }

  const requestedAction=String(body.action || "update").trim();
  const action=["read","postpone","undo_postpone","attention"].includes(requestedAction) ? requestedAction : "update";
  const pageId=String(body.pageId || "").trim();
  const hasDueFields=Object.prototype.hasOwnProperty.call(body,"dueDate") || Object.prototype.hasOwnProperty.call(body,"dueTime");
  const accessToken=bearerToken(req);

  if(accessToken){
    const supabaseUrl=Netlify.env.get("SUPABASE_URL");
    const publishableKey=Netlify.env.get("SUPABASE_PUBLISHABLE_KEY");
    if(!supabaseUrl || !publishableKey) return json(503,{error:"Data Core 편집 설정이 아직 준비되지 않았습니다."});
    try{
      const client=createSupabaseDataCoreRestClient({supabaseUrl,publishableKey,accessToken});
      const editor=createWorklogDataCoreEditor({client});
      if(action==="read"){
        const current=await editor.readDetails({recordId:pageId});
        const due=seoulDueFields(current.dueAt,current.dueHasTime);
        return json(200,{ok:true,pageId:current.recordId,title:current.title,...due,actionKind:current.actionKind || "",actionConversionAllowed:current.actionConversionAllowed===true,mode:"data_core"});
      }

      if(action==="postpone"){
        let normalized:any;
        try{ normalized=normalizeWorklogDueInput(body.dueDate,body.dueTime); }
        catch(error:any){ return json(400,{error:error.message}); }
        if(!normalized.dueAt) return json(400,{error:"미룰 날짜를 선택해주세요."});
        const result=await editor.postpone({recordId:pageId,dueAt:normalized.dueAt,dueHasTime:normalized.dueHasTime});
        return json(200,{ok:true,pageId:result.recordId,dueDate:normalized.dueDate,dueTime:normalized.dueTime,previousDueAt:result.previousDueAt,previousDueHasTime:result.previousDueHasTime,mode:"data_core"});
      }

      if(action==="undo_postpone"){
        const result=await editor.undoPostpone({recordId:pageId});
        const due=seoulDueFields(result.dueAt,result.dueHasTime);
        return json(200,{ok:true,pageId:result.recordId,...due,mode:"data_core"});
      }

      if(action==="attention"){
        const nextAttentionAt=Object.prototype.hasOwnProperty.call(body,"nextAttentionAt") ? body.nextAttentionAt : null;
        const result=await editor.setAttention({recordId:pageId,nextAttentionAt});
        return json(200,{ok:true,pageId:result.recordId,nextAttentionAt:result.nextAttentionAt,previousAttentionAt:result.previousAttentionAt,mode:"data_core"});
      }

      const nextTitle=normalizeWorklogTitle(body.title);
      if(!nextTitle) return json(400,{error:"업무명을 입력해주세요."});
      if(nextTitle.length>160) return json(400,{error:"업무명은 160자 이하로 입력해주세요."});

      let dueAt:any=null;
      let dueHasTime=false;
      let dueDate="";
      let dueTime="";
      if(hasDueFields){
        let normalized:any;
        try{ normalized=normalizeWorklogDueInput(body.dueDate,body.dueTime); }
        catch(error:any){ return json(400,{error:error.message}); }
        ({dueAt,dueHasTime,dueDate,dueTime}=normalized);
      }else{
        const current=await editor.readDetails({recordId:pageId});
        dueAt=current.dueAt;
        dueHasTime=current.dueHasTime;
        ({dueDate,dueTime}=seoulDueFields(dueAt,dueHasTime));
      }

      const requestedActionKind=Object.prototype.hasOwnProperty.call(body,"actionKind")
        ? String(body.actionKind || "").trim().toLowerCase()
        : null;
      if(requestedActionKind!==null && requestedActionKind!=="" && !["task","note"].includes(requestedActionKind)){
        return json(400,{error:"업무 종류를 확인해주세요."});
      }

      const result=await editor.updateDetails({
        recordId:pageId,
        title:nextTitle,
        dueAt,
        dueHasTime,
        actionKind:requestedActionKind || null
      });
      return json(200,{ok:true,pageId:result.recordId,title:result.title,dueDate,dueTime,actionKind:result.actionKind || requestedActionKind || "",actionKindChanged:result.actionKindChanged===true,scheduleUpdated:result.scheduleUpdated,mode:"data_core"});
    }catch(error:any){
      return dataCoreErrorResponse(error);
    }
  }

  const connection:any=resolveConnection(req);
  if(connection.error) return json(connection.status || 400,{error:connection.error});
  const {token,dataSourceId,mode}=connection;
  if(!validWorklogPageId(pageId)) return json(400,{error:"수정할 업무 식별자가 올바르지 않습니다."});

  if(action==="postpone" || action==="undo_postpone" || action==="attention"){
    return json(409,{error:"미루기와 다시 알림은 Data Core 업무에서만 지원합니다."});
  }

  try{
    const page=await getVerifiedPage(token,pageId,dataSourceId);
    const previousTitle=titleValue(page?.properties?.["업무명"]);
    const previousDue=String(page?.properties?.["기한"]?.date?.start || "");
    if(action==="read"){
      return json(200,{ok:true,pageId,title:previousTitle,...seoulDueFields(previousDue,previousDue.includes("T")),actionKind:"",actionConversionAllowed:false,mode});
    }

    if(Object.prototype.hasOwnProperty.call(body,"actionKind") && String(body.actionKind || "").trim()){
      return json(409,{error:"업무 종류 변경은 Data Core 업무에서만 지원합니다."});
    }

    const nextTitle=normalizeWorklogTitle(body.title);
    if(!nextTitle) return json(400,{error:"업무명을 입력해주세요."});
    if(nextTitle.length>160) return json(400,{error:"업무명은 160자 이하로 입력해주세요."});

    let dueStart: string|null|undefined=undefined;
    let dueDate="";
    let dueTime="";
    if(hasDueFields){
      let normalized:any;
      try{ normalized=normalizeWorklogDueInput(body.dueDate,body.dueTime); }
      catch(error:any){ return json(400,{error:error.message}); }
      dueDate=normalized.dueDate;
      dueTime=normalized.dueTime;
      dueStart=normalized.dueAt ? (normalized.dueHasTime ? normalized.dueAt : normalized.dueDate) : null;
    }else{
      ({dueDate,dueTime}=seoulDueFields(previousDue,previousDue.includes("T")));
    }

    const unchangedTitle=previousTitle===nextTitle;
    const unchangedDue=!hasDueFields || previousDue===String(dueStart || "");
    if(unchangedTitle && unchangedDue) return json(200,{ok:true,unchanged:true,pageId,title:nextTitle,dueDate,dueTime,mode});

    await updateNotionWorklog(token,pageId,nextTitle,dueStart);
    return json(200,{ok:true,pageId,title:nextTitle,previousTitle,dueDate,dueTime,mode});
  }catch(error:any){
    if(error?.status===403) return json(403,{error:"이 업무는 현재 연결된 업무수첩에서 수정할 수 없습니다."});
    if(mode==="personal" && (error?.status===401 || error?.status===404)) return json(401,{error:"개인 Notion 연결이 만료되었거나 업무를 찾을 수 없습니다. 다시 연결해주세요."});
    console.error(error);
    return json(502,{error:"Notion 업무 수정에 실패했습니다."});
  }
};

export const config:Config={path:"/api/worklog-edit",method:["POST"]};
