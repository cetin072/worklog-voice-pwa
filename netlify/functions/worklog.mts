import type { Config, Context } from "@netlify/functions";
import { getDeployStore, getStore } from "@netlify/blobs";
import { idempotencyHit, isValidClientRequestId, seoulDateFromRecordedAt } from "../shared/core-logic.mjs";
import { classifyWorklogAction } from "../shared/action-engine-v1.mjs";
import { multiActionChildRequestId, splitMultiActionText } from "../shared/multi-action-splitter.mjs";
import { extractScheduleFromText } from "../shared/schedule-extract.mjs";
import { createNotionWorklogAdapter } from "../shared/notion-worklog-adapter.mjs";
import { createSupabaseDataCoreRestClient } from "../shared/data-core/supabase-rest-client.mjs";
import { createWorklogDataCoreAdapter } from "../shared/worklog-data-core-adapter.mjs";
import { createDualWriteCoordinator } from "../shared/dual-write-coordinator.mjs";
import { createSupabaseWorkspaceContextResolver } from "../shared/platform/supabase-workspace-context.mjs";
import { createWorklogPrimarySave } from "../shared/worklog-primary-save.mjs";

const NOTION_VERSION = "2026-03-11";
const DEFAULT_DATA_SOURCE_ID = "e345d19d-504f-4466-815a-912b1d6b9a3a";

const INSTITUTIONS = new Set(["태장","미래여성가족진흥원","기타"]);
const STATUSES = new Set(["완료","진행중","대기","확인필요"]);
const TYPES = new Set(["완료업무","할 일","회의·통화","지출·세무","지시·위임","아이디어","문제·확인","기타"]);
const TRUSTED_INSTITUTION_SOURCES = new Set(["user_selected","user_confirmed"]);

function json(status:number, body:Record<string,unknown>){
  return new Response(JSON.stringify(body), {
    status,
    headers:{"content-type":"application/json; charset=utf-8"}
  });
}
function personalConnection(req:Request){
  const token=(req.headers.get("x-notion-token") || "").trim();
  const dataSourceId=(req.headers.get("x-notion-data-source-id") || "").trim();
  if(!token && !dataSourceId) return null;
  if(!token || !dataSourceId) return {error:"개인 Notion 연결 정보가 불완전합니다."};
  if(token.length>300 || dataSourceId.length>100) return {error:"개인 Notion 연결 정보 형식이 올바르지 않습니다."};
  return {token,dataSourceId,mode:"personal" as const};
}

function isProductionRequest(requestUrl:string){
  const siteUrl=(Netlify.env.get("URL") || "https://worklog-voice-pwa.netlify.app").replace(/\/$/,"");
  try{
    return new URL(requestUrl).host===new URL(siteUrl).host;
  }catch{
    return false;
  }
}

function idempotencyStore(production:boolean){
  return production
    ? getStore("worklog-idempotency",{consistency:"strong"})
    : getDeployStore("worklog-idempotency");
}

function dataCoreDualWriteEnabled(){
  return String(Netlify.env.get("WORKLOG_DATA_CORE_DUAL_WRITE_ENABLED") || "").trim().toLowerCase()==="true";
}

function dataCorePrimaryEnabled(){
  return String(Netlify.env.get("WORKLOG_DATA_CORE_PRIMARY_ENABLED") || "").trim().toLowerCase()==="true";
}

function bearerToken(req:Request){
  const header=String(req.headers.get("authorization") || "");
  const match=/^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : "";
}

function fastSaveRpcUnavailable(error:any){
  return error?.code==="SUPABASE_DATA_CORE_RPC_FAILED";
}

function fastSaveWorkspaceMissing(error:any){
  return error?.code==="WORKLOG_DATA_CORE_FAST_WORKSPACE_MISSING"
    || /PERSONAL_WORKSPACE_MISSING/i.test(String(error?.message || ""));
}

async function queueRecordNormalization(req:Request,accessToken:string,workRecordIdValue:unknown){
  const workRecordId=String(workRecordIdValue || "").trim();
  if(!accessToken || !/^[0-9a-f-]{36}$/i.test(workRecordId)) return false;
  try{
    const endpoint=new URL("/api/record-normalize",req.url);
    const response=await fetch(endpoint,{
      method:"POST",
      headers:{authorization:`Bearer ${accessToken}`,"content-type":"application/json"},
      body:JSON.stringify({workRecordId})
    });
    const accepted=response.status===202 || response.ok;
    if(!accepted) console.warn("Worklog normalization queue rejected",response.status);
    return accepted;
  }catch(error){
    console.warn("Worklog normalization queue failed",String((error as any)?.message || "unknown").slice(0,120));
    return false;
  }
}

export default async (req:Request, _context:Context) => {
  const personal=personalConnection(req);
  const envToken = Netlify.env.get("NOTION_TOKEN");
  const accessKey = Netlify.env.get("APP_ACCESS_KEY");
  const envDataSourceId = Netlify.env.get("NOTION_DATA_SOURCE_ID") || DEFAULT_DATA_SOURCE_ID;
  const accessToken=bearerToken(req);
  const primaryRequested=dataCorePrimaryEnabled() && Boolean(accessToken);

  if(req.method==="GET"){
    if(primaryRequested){
      return json(200,{ok:true,configured:Boolean(Netlify.env.get("SUPABASE_URL") && Netlify.env.get("SUPABASE_PUBLISHABLE_KEY")),mode:"data_core",notionConfigured:Boolean((personal && !("error" in personal)) || (envToken && accessKey))});
    }
    if(personal && "error" in personal) return json(400,{ok:false,configured:false,error:personal.error});
    if(personal) return json(200,{ok:true,configured:true,mode:"personal"});
    return json(200,{ok:true,configured:Boolean(envToken && accessKey && envDataSourceId),mode:"owner"});
  }

  if(req.method!=="POST") return json(405,{error:"허용되지 않은 요청입니다."});

  let token="";
  let dataSourceId="";
  let mode:string="data_core";
  let notionConfigured=false;

  if(primaryRequested){
    if(personal && !("error" in personal)){
      token=personal.token;
      dataSourceId=personal.dataSourceId;
      mode="personal";
      notionConfigured=true;
    }else if(!personal && envToken && accessKey && (req.headers.get("x-worklog-key")||"")===accessKey){
      token=envToken;
      dataSourceId=envDataSourceId;
      mode="owner";
      notionConfigured=true;
    }
  }else{
    if(personal && "error" in personal) return json(400,{error:personal.error});
    if(personal){
      token=personal.token;
      dataSourceId=personal.dataSourceId;
      mode="personal";
      notionConfigured=true;
    }else{
      if(!envToken) return json(500,{error:"NOTION_TOKEN이 설정되지 않았습니다."});
      if(!accessKey) return json(500,{error:"APP_ACCESS_KEY가 설정되지 않았습니다."});
      if((req.headers.get("x-worklog-key")||"")!==accessKey) return json(401,{error:"개인 접근키가 올바르지 않습니다."});
      token=envToken;
      dataSourceId=envDataSourceId;
      mode="owner";
      notionConfigured=true;
    }
  }

  let body:any;
  try{ body=await req.json(); }catch{ return json(400,{error:"요청 형식이 올바르지 않습니다."}); }

  const transcript=String(body.transcript||"").trim();
  if(!transcript) return json(400,{error:"업무 내용이 비어 있습니다."});
  if(transcript.length>1800) return json(400,{error:"업무 내용은 1,800자 이하로 입력해주세요."});

  const requestId=String(body.clientRequestId || "").trim();
  const idem=isValidClientRequestId(requestId) ? idempotencyStore(isProductionRequest(req.url)) : null;
  let existing:any=null;
  if(idem){
    try{
      existing=await idem.get(`request:${requestId}`,{type:"json"});
      const duplicate=idempotencyHit(existing,mode);
      if(duplicate && !((dataCoreDualWriteEnabled() || dataCorePrimaryEnabled()) && accessToken)) return json(200,{ok:true,...duplicate});
    }catch(error){
      console.warn("Worklog idempotency read failed",String((error as any)?.message || "unknown").slice(0,120));
    }
  }

  const requestedInstitution=String(body.institution || "").trim().slice(0,60);
  const requestedInstitutionSource=String(body.institutionSource || body.institution_source || "").trim().toLowerCase();
  const institutionSource=TRUSTED_INSTITUTION_SOURCES.has(requestedInstitutionSource) ? requestedInstitutionSource : "unverified";
  const institution=mode==="personal"
    ? (requestedInstitution || "기타")
    : (INSTITUTIONS.has(requestedInstitution) ? requestedInstitution : "기타");
  const requestedStatus=STATUSES.has(body.status) ? body.status : "";
  const requestedType=TYPES.has(body.type) ? body.type : "";

  const recordedAtValue=body.recordedAt || new Date().toISOString();
  const explicitDueDate=String(body.dueDate || "").trim();
  const hasExplicitDueDate=/^\d{4}-\d{2}-\d{2}$/.test(explicitDueDate);
  const requestedSourceType=String(body.sourceType || "direct").trim().toLowerCase();
  const sourceType=["direct","voice","call","meeting","mail","capture","scan","notion","import","other"].includes(requestedSourceType)
    ? requestedSourceType
    : "direct";
  const assignee=String(body.assignee||"").trim();
  const followUp=String(body.followUp||"").trim();
  const hasManualExtras=Boolean(body.amount !== undefined && body.amount !== null && body.amount !== "")
    || Boolean(assignee)
    || hasExplicitDueDate
    || Boolean(followUp);
  const split=splitMultiActionText(transcript);
  const canAutoSplit=primaryRequested
    && sourceType==="voice"
    && split.matched
    && !split.truncated
    && !hasManualExtras
    && !requestedStatus
    && !requestedType;

  function classifiedRecord(segment:string,clientRequestId:string,index:number|null=null,total:number|null=null){
    const segmentSchedule=extractScheduleFromText(segment,recordedAtValue);
    const segmentAction=classifyWorklogAction({
      transcript:segment,
      recordedAt:recordedAtValue,
      explicitType:index===null ? requestedType : "",
      schedule:segmentSchedule,
    });
    const segmentStatus=(index===null ? requestedStatus : "") || (segmentAction.needsReview ? "확인필요" : "진행중");
    const segmentType=(index===null ? requestedType : "") || (segmentAction.kind==="schedule" ? "회의·통화" : segmentAction.kind==="task" ? "할 일" : "기타");
    const segmentClean=String(segmentSchedule.text || segment).trim() || segment;
    const actionEngine={
      version:"action-engine-v1",
      kind:segmentAction.kind,
      actionKind:segmentAction.actionKind,
      journalDate:segmentAction.journalDate,
      reason:segmentAction.reason,
      confidence:segmentAction.confidence,
      needsReview:segmentAction.needsReview,
      ...(index!==null && total!==null ? {multiAction:{parentRequestId:requestId,segmentIndex:index+1,segmentCount:total}} : {})
    };
    return {
      schedule:segmentSchedule,
      action:segmentAction,
      cleanTranscript:segmentClean,
      record:{
        clientRequestId, transcript:segment, cleanTranscript:segmentClean, institution, institutionSource,
        status:segmentStatus, type:segmentType,
        actionKind:segmentAction.actionKind, journalDate:segmentAction.journalDate, actionEngine,
        recordedAt:recordedAtValue,
        recordedDate:seoulDateFromRecordedAt(recordedAtValue),
        amount:index===null ? body.amount : null,
        assignee:index===null ? assignee : "",
        followUp:index===null ? followUp : "",
        dueStart:segmentSchedule.dueStart
      }
    };
  }

  const single=classifiedRecord(transcript,requestId);
  const schedule=single.schedule;
  const action=single.action;
  const cleanTranscript=single.cleanTranscript;
  const record=single.record;
  const multiRecords=canAutoSplit
    ? split.segments.map((segment,index)=>classifiedRecord(
        segment,
        multiActionChildRequestId(requestId,index),
        index,
        split.segments.length
      ).record)
    : [];

  if(primaryRequested){
    const supabaseUrl=Netlify.env.get("SUPABASE_URL");
    const publishableKey=Netlify.env.get("SUPABASE_PUBLISHABLE_KEY");
    if(!supabaseUrl || !publishableKey) return json(503,{error:"Data Core primary 저장 설정이 아직 준비되지 않았습니다. 원문은 그대로 유지되어 재시도할 수 있습니다."});
    if(!requestId || !idem) return json(400,{error:"Data Core 저장에는 유효한 저장 요청 ID가 필요합니다."});

    try{
      const client=createSupabaseDataCoreRestClient({supabaseUrl,publishableKey,accessToken});
      const dataCore=createWorklogDataCoreAdapter({client});
      const resolver=createSupabaseWorkspaceContextResolver({supabaseUrl,publishableKey});
      let workspaceContext:any=null;
      let fastDataCore:any=null;
      let fastPath=false;

      try{
        fastDataCore=multiRecords.length>1
          ? await dataCore.persistManyFast({
              parentRequestId:requestId,
              originalText:transcript,
              source:sourceType,
              recordedAt:recordedAtValue,
              records:multiRecords
            })
          : await dataCore.persistFast(record);
        fastPath=true;
      }catch(fastError:any){
        if(fastSaveWorkspaceMissing(fastError)){
          workspaceContext=await resolver.resolve(accessToken);
          try{
            fastDataCore=multiRecords.length>1
              ? await dataCore.persistManyFast({
                  parentRequestId:requestId,
                  originalText:transcript,
                  source:sourceType,
                  recordedAt:recordedAtValue,
                  records:multiRecords
                })
              : await dataCore.persistFast(record);
            fastPath=true;
          }catch(retryError:any){
            console.warn("Worklog fast save repair retry failed",String(retryError?.code || "unknown"),String(retryError?.message || "unknown").slice(0,120));
          }
        }else if(fastSaveRpcUnavailable(fastError)){
          if(multiRecords.length>1){
            console.warn("Worklog multi-action RPC unavailable; preserving original as one WorkRecord",String(fastError?.message || "unknown").slice(0,120));
            fastDataCore=await dataCore.persistFast(record);
            fastPath=true;
          }else{
            console.warn("Worklog fast save unavailable; using legacy Data Core path",String(fastError?.message || "unknown").slice(0,120));
          }
        }else{
          throw fastError;
        }
      }

      if(fastDataCore?.multiAction){
        const normalizationResults=await Promise.all(
          (fastDataCore.workRecordIds || []).map((workRecordId:string)=>queueRecordNormalization(req,accessToken,workRecordId))
        );
        const scheduleIds=Array.isArray(fastDataCore.scheduleIds) ? fastDataCore.scheduleIds : [];
        return json(200,{
          ok:true,
          mode:"data_core",
          multiAction:true,
          splitCount:Number(fastDataCore.savedCount || multiRecords.length),
          captureId:String(fastDataCore.captureId || ""),
          dataCoreWorkRecordId:String(fastDataCore.workRecordId || ""),
          dataCoreWorkRecordIds:fastDataCore.workRecordIds || [],
          scheduleCreated:scheduleIds.length>0,
          scheduleId:String(fastDataCore.scheduleId || ""),
          scheduleIds,
          normalizationQueued:normalizationResults.every(Boolean),
          notionSync:notionConfigured ? "pending" : "disabled"
        });
      }

      if(!fastDataCore){
        if(!workspaceContext) workspaceContext=await resolver.resolve(accessToken);
      }

      const userId=String(fastDataCore?.userId || workspaceContext?.userId || "").trim();
      if(!userId) throw new Error("WORKLOG_DATA_CORE_USER_ID_MISSING");
      const primaryKey=`request:${requestId}:user:${userId}`;
      let primaryExisting:any=null;
      try{ primaryExisting=await idem.get(primaryKey,{type:"json"}); }
      catch(error){ console.warn("Worklog primary idempotency read failed",String((error as any)?.message || "unknown").slice(0,120)); }

      if(fastDataCore){
        const hadDataCore=Boolean(primaryExisting?.dataCore);
        primaryExisting={...(primaryExisting || {}),dataCore:fastDataCore};
        if(!hadDataCore){
          try{ await idem.setJSON(primaryKey,{...primaryExisting,mode,createdAt:new Date().toISOString()}); }
          catch(error){ console.warn("Worklog primary fast-path progress write failed",String((error as any)?.message || "unknown").slice(0,120)); }
        }
      }

      const notion=notionConfigured ? createNotionWorklogAdapter({token,dataSourceId,notionVersion:NOTION_VERSION}) : null;
      const primary=createWorklogPrimarySave({
        writeDataCore:()=>fastDataCore || dataCore.persist(record,workspaceContext),
        writeNotion:notion ? ()=>notion.create(record) : null,
        saveProgress:async progress=>{
          try{ await idem.setJSON(primaryKey,{...progress,mode,createdAt:new Date().toISOString()}); }
          catch(error){ console.warn("Worklog primary idempotency write failed",String((error as any)?.message || "unknown").slice(0,120)); }
        }
      });
      const result=await primary.execute(record,primaryExisting || {});
      const normalizationQueued=await queueRecordNormalization(req,accessToken,result.dataCore.workRecordId);
      return json(200,{ok:true,mode:"data_core",scheduleDetected:Boolean(schedule.matched),scheduleCreated:Boolean(result.dataCore?.scheduleId),scheduleId:String(result.dataCore?.scheduleId || ""),dueStart:String(schedule.dueStart || ""),cleanTranscript,actionClass:action.kind,actionKind:action.actionKind,actionNeedsReview:action.needsReview,journalDate:action.journalDate,dataCoreWorkRecordId:result.dataCore.workRecordId,dataCoreFastPath:fastPath,normalizationQueued,notionSync:result.notionSync,notionPageId:result.notion?.pageId || "",notionUrl:result.notion?.url || "",notionErrorCode:result.notionErrorCode});
    }catch(err:any){
      if(err?.code==="SUPABASE_WORKSPACE_AUTH_FAILED" || err?.code==="SUPABASE_WORKSPACE_ACCESS_TOKEN_REQUIRED") return json(401,{error:"Platform 로그인 세션을 확인하지 못했습니다. 다시 로그인한 뒤 저장해주세요."});
      console.error("Worklog primary error",String(err?.code || "unknown"),String(err?.message || "unknown").slice(0,160));
      return json(502,{error:"Data Core 저장에 실패했습니다. 원문은 유지되며 다시 저장할 수 있습니다."});
    }
  }

  if(dataCoreDualWriteEnabled() && accessToken){
    const supabaseUrl=Netlify.env.get("SUPABASE_URL");
    const publishableKey=Netlify.env.get("SUPABASE_PUBLISHABLE_KEY");
    if(!supabaseUrl || !publishableKey) return json(503,{error:"Data Core dual-write 설정이 아직 준비되지 않았습니다. 원문은 그대로 유지되어 재시도할 수 있습니다."});
    if(!requestId || !idem) return json(400,{error:"Data Core 저장에는 유효한 저장 요청 ID가 필요합니다."});

    try{
      const resolver=createSupabaseWorkspaceContextResolver({supabaseUrl,publishableKey});
      const workspaceContext=await resolver.resolve(accessToken);
      const dualKey=`request:${requestId}:user:${workspaceContext.userId}`;
      let dualExisting:any=null;
      try{ dualExisting=await idem.get(dualKey,{type:"json"}); }
      catch(error){ console.warn("Worklog dual-write idempotency read failed",String((error as any)?.message || "unknown").slice(0,120)); }

      const prior=dualExisting || (existing?.pageId ? {notion:{pageId:existing.pageId,url:existing.url || ""}} : {});
      if(prior.dataCore && prior.notion){
        const normalizationQueued=await queueRecordNormalization(req,accessToken,prior.dataCore.workRecordId);
        return json(200,{ok:true,pageId:prior.notion.pageId,url:prior.notion.url,mode,scheduleDetected:Boolean(schedule.matched),scheduleCreated:Boolean(prior.dataCore?.scheduleId),scheduleId:String(prior.dataCore?.scheduleId || ""),dueStart:String(schedule.dueStart || ""),cleanTranscript,deduped:true,dataCoreWorkRecordId:prior.dataCore.workRecordId || "",normalizationQueued});
      }

      const notion=createNotionWorklogAdapter({token,dataSourceId,notionVersion:NOTION_VERSION});
      const dataCore=createWorklogDataCoreAdapter({client:createSupabaseDataCoreRestClient({supabaseUrl,publishableKey,accessToken})});
      const coordinator=createDualWriteCoordinator({
        writeDataCore:()=>dataCore.persist(record,workspaceContext),
        writeNotion:()=>notion.create(record),
        saveProgress:async progress=>{
          try{ await idem.setJSON(dualKey,{...progress,mode,createdAt:new Date().toISOString()}); }
          catch(error){ console.warn("Worklog dual-write idempotency write failed",String((error as any)?.message || "unknown").slice(0,120)); }
        }
      });
      const result=await coordinator.execute(record,prior);
      if(!result.complete){
        return json(503,{ok:false,error:"한 저장소에만 저장되었습니다. 원문은 유지되며 같은 내용을 다시 저장하면 완료되지 않은 저장소만 재시도합니다.",retryable:true,notionSaved:Boolean(result.notion),dataCoreSaved:Boolean(result.dataCore)});
      }
      const normalizationQueued=await queueRecordNormalization(req,accessToken,result.dataCore.workRecordId);
      return json(200,{ok:true,pageId:result.notion.pageId,url:result.notion.url,mode,scheduleDetected:Boolean(schedule.matched),scheduleCreated:Boolean(result.dataCore?.scheduleId),scheduleId:String(result.dataCore?.scheduleId || ""),dueStart:String(schedule.dueStart || ""),cleanTranscript,actionClass:action.kind,actionKind:action.actionKind,actionNeedsReview:action.needsReview,journalDate:action.journalDate,dataCoreWorkRecordId:result.dataCore.workRecordId,normalizationQueued});
    }catch(err:any){
      if(err?.code==="SUPABASE_WORKSPACE_AUTH_FAILED" || err?.code==="SUPABASE_WORKSPACE_ACCESS_TOKEN_REQUIRED") return json(401,{error:"Platform 로그인 세션을 확인하지 못했습니다. 다시 로그인한 뒤 저장해주세요."});
      console.error("Worklog dual-write error",String(err?.code || "unknown"),String(err?.message || "unknown").slice(0,160));
      return json(502,{error:"Data Core와 Notion 저장에 실패했습니다. 원문은 유지되며 다시 저장할 수 있습니다."});
    }
  }

  try{
    const notion=createNotionWorklogAdapter({token,dataSourceId,notionVersion:NOTION_VERSION});
    const data=await notion.create(record);

    if(idem){
      try{
        await idem.setJSON(`request:${requestId}`,{
          pageId:data.pageId,
          url:data.url,
          mode,
          createdAt:new Date().toISOString()
        });
      }catch(error){
        console.warn("Worklog idempotency write failed",String((error as any)?.message || "unknown").slice(0,120));
      }
    }

    return json(200,{
      ok:true,
      pageId:data.pageId,
      url:data.url,
      mode,
      scheduleDetected:Boolean(schedule.matched),
      scheduleCreated:false,
      scheduleId:"",
      dueStart:String(schedule.dueStart || ""),
      cleanTranscript,
      actionClass:action.kind,
      actionKind:action.actionKind,
      actionNeedsReview:action.needsReview,
      journalDate:action.journalDate
    });
  }catch(err:any){
    const notionStatus=Number(err?.notionStatus || 0);
    if(err?.code==="NOTION_WORKLOG_WRITE_FAILED"){
      console.error("Notion worklog error",notionStatus,String(err?.notionCode || "").slice(0,300));
      if(mode==="personal" && (notionStatus===401 || notionStatus===404)){
        return json(401,{error:"개인 Notion 연결이 만료되었거나 DB를 찾을 수 없습니다. ‘내 Notion으로 시작하기’에서 다시 연결해주세요."});
      }
      return json(502,{error:"Notion 저장에 실패했습니다. 토큰과 DB 연결 권한을 확인해주세요.", notionStatus});
    }
    console.error(err);
    return json(502,{error:"Notion 서버에 연결하지 못했습니다."});
  }
};

export const config:Config = {
  path:"/api/worklog",
  method:["GET","POST"]
};