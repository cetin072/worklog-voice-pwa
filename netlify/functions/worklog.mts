import type { Config, Context } from "@netlify/functions";
import { getDeployStore, getStore } from "@netlify/blobs";
import { idempotencyHit, isValidClientRequestId, seoulDateFromRecordedAt } from "../shared/core-logic.mjs";
import { extractScheduleFromText } from "../shared/schedule-extract.mjs";
import { createNotionWorklogAdapter } from "../shared/notion-worklog-adapter.mjs";

const NOTION_VERSION = "2026-03-11";
const DEFAULT_DATA_SOURCE_ID = "e345d19d-504f-4466-815a-912b1d6b9a3a";

const INSTITUTIONS = new Set(["태장","미래여성가족진흥원","기타"]);
const STATUSES = new Set(["완료","진행중","대기","확인필요"]);
const TYPES = new Set(["완료업무","할 일","회의·통화","지출·세무","지시·위임","아이디어","문제·확인","기타"]);

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

export default async (req:Request, _context:Context) => {
  const personal=personalConnection(req);
  const envToken = Netlify.env.get("NOTION_TOKEN");
  const accessKey = Netlify.env.get("APP_ACCESS_KEY");
  const envDataSourceId = Netlify.env.get("NOTION_DATA_SOURCE_ID") || DEFAULT_DATA_SOURCE_ID;

  if(req.method==="GET"){
    if(personal && "error" in personal) return json(400,{ok:false,configured:false,error:personal.error});
    if(personal) return json(200,{ok:true,configured:true,mode:"personal"});
    return json(200,{ok:true,configured:Boolean(envToken && accessKey && envDataSourceId),mode:"owner"});
  }

  if(req.method!=="POST") return json(405,{error:"허용되지 않은 요청입니다."});
  if(personal && "error" in personal) return json(400,{error:personal.error});

  let token:string;
  let dataSourceId:string;
  let mode:"personal"|"owner";

  if(personal){
    token=personal.token;
    dataSourceId=personal.dataSourceId;
    mode="personal";
  }else{
    if(!envToken) return json(500,{error:"NOTION_TOKEN이 설정되지 않았습니다."});
    if(!accessKey) return json(500,{error:"APP_ACCESS_KEY가 설정되지 않았습니다."});
    if((req.headers.get("x-worklog-key")||"")!==accessKey) return json(401,{error:"개인 접근키가 올바르지 않습니다."});
    token=envToken;
    dataSourceId=envDataSourceId;
    mode="owner";
  }

  let body:any;
  try{ body=await req.json(); }catch{ return json(400,{error:"요청 형식이 올바르지 않습니다."}); }

  const transcript=String(body.transcript||"").trim();
  if(!transcript) return json(400,{error:"업무 내용이 비어 있습니다."});
  if(transcript.length>1800) return json(400,{error:"업무 내용은 1,800자 이하로 입력해주세요."});

  const requestId=String(body.clientRequestId || "").trim();
  const idem=isValidClientRequestId(requestId) ? idempotencyStore(isProductionRequest(req.url)) : null;
  if(idem){
    try{
      const existing:any=await idem.get(`request:${requestId}`,{type:"json"});
      const duplicate=idempotencyHit(existing,mode);
      if(duplicate) return json(200,{ok:true,...duplicate});
    }catch(error){
      console.warn("Worklog idempotency read failed",String((error as any)?.message || "unknown").slice(0,120));
    }
  }

  const requestedInstitution=String(body.institution || "").trim().slice(0,60);
  const institution=mode==="personal"
    ? (requestedInstitution || "기타")
    : (INSTITUTIONS.has(requestedInstitution) ? requestedInstitution : "기타");
  const status=STATUSES.has(body.status) ? body.status : "진행중";
  const type=TYPES.has(body.type) ? body.type : "기타";

  const explicitDueDate=String(body.dueDate || "").trim();
  const hasExplicitDueDate=/^\d{4}-\d{2}-\d{2}$/.test(explicitDueDate);
  const schedule=hasExplicitDueDate
    ? {text:transcript,dueStart:explicitDueDate,matched:false,hasTime:false}
    : extractScheduleFromText(transcript,body.recordedAt || new Date());
  const cleanTranscript=String(schedule.text || transcript).trim() || transcript;

  try{
    const notion=createNotionWorklogAdapter({token,dataSourceId,notionVersion:NOTION_VERSION});
    const data=await notion.create({
      transcript, cleanTranscript, institution, status, type,
      recordedDate:seoulDateFromRecordedAt(body.recordedAt),
      amount:body.amount, assignee:String(body.assignee||"").trim(), followUp:String(body.followUp||"").trim(), dueStart:schedule.dueStart
    });

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
      dueStart:String(schedule.dueStart || ""),
      cleanTranscript
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
