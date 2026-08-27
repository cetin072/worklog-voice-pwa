import type { Config, Context } from "@netlify/functions";

const NOTION_VERSION = "2026-03-11";
const DEFAULT_DATA_SOURCE_ID = "e345d19d-504f-4466-815a-912b1d6b9a3a";
const BRIEFING_PROJECT = "SYSTEM_DAILY_BRIEFING";
const ALLOWED_STATUSES = new Set(["완료","진행중","대기","확인필요"]);

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

async function querySnapshot(token:string,dataSourceId:string){
  const res=await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`,{
    method:"POST",
    headers:notionHeaders(token),
    body:JSON.stringify({
      page_size:10,
      filter:{property:"프로젝트",rich_text:{equals:BRIEFING_PROJECT}},
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

async function getPageStatus(token:string,pageId:string){
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
  return String(data?.properties?.["상태"]?.select?.name || data?.properties?.["상태"]?.status?.name || "");
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

function sanitizeSnapshot(raw:any){
  const safeArray=(value:any)=>Array.isArray(value) ? value.slice(0,5) : [];
  return {
    generatedAt:String(raw?.generatedAt || ""),
    period:String(raw?.period || ""),
    meta:String(raw?.meta || ""),
    top:safeArray(raw?.top).map((item:any)=>({
      title:String(item?.title || ""),
      note:String(item?.note || ""),
      institution:String(item?.institution || ""),
      pageId:String(item?.pageId || "")
    })).filter((item:any)=>item.title),
    today:safeArray(raw?.today).map((item:any)=>({
      title:String(item?.title || ""),
      when:String(item?.when || "")
    })).filter((item:any)=>item.title),
    upcoming:safeArray(raw?.upcoming).map((item:any)=>({
      title:String(item?.title || ""),
      when:String(item?.when || "")
    })).filter((item:any)=>item.title),
    checking:safeArray(raw?.checking).map((item:any)=>String(item || "")).filter(Boolean)
  };
}

async function enrichTopStatuses(token:string,briefing:any){
  briefing.top=await Promise.all((briefing.top || []).map(async(item:any)=>{
    if(!item.pageId || !validPageId(item.pageId)) return {...item,status:""};
    try{
      const status=await getPageStatus(token,item.pageId);
      return {...item,status};
    }catch{
      return {...item,status:""};
    }
  }));
  return briefing;
}

function parseLineSnapshot(rawText:string){
  if(!rawText.startsWith("BRIEFING_V1")) return null;

  const parsed:any={generatedAt:"",period:"",meta:"",top:[],today:[],upcoming:[],checking:[]};
  for(const rawLine of rawText.split(/\r?\n/).slice(1)){
    const line=rawLine.trim();
    if(!line) continue;

    if(line.startsWith("generatedAt=")) parsed.generatedAt=line.slice("generatedAt=".length).trim();
    else if(line.startsWith("period=")) parsed.period=line.slice("period=".length).trim();
    else if(line.startsWith("meta=")) parsed.meta=line.slice("meta=".length).trim();
    else if(line.startsWith("TOP|")){
      const [,title="",note="",institution="",pageId=""]=line.split("|");
      if(title.trim()) parsed.top.push({title:title.trim(),note:note.trim(),institution:institution.trim(),pageId:pageId.trim()});
    }else if(line.startsWith("TODAY|")){
      const [,title="",when=""]=line.split("|");
      if(title.trim()) parsed.today.push({title:title.trim(),when:when.trim()});
    }else if(line.startsWith("UPCOMING|")){
      const [,title="",when=""]=line.split("|");
      if(title.trim()) parsed.upcoming.push({title:title.trim(),when:when.trim()});
    }else if(line.startsWith("CHECK|")){
      const text=line.slice("CHECK|".length).trim();
      if(text) parsed.checking.push(text);
    }
  }
  return parsed;
}

function parseStoredSnapshot(rawText:string){
  try{ return JSON.parse(rawText); }
  catch{}
  return parseLineSnapshot(rawText);
}

export default async (req:Request, _context:Context) => {
  if(req.method!=="GET" && req.method!=="POST") return json(405,{error:"허용되지 않은 요청입니다."});

  const connection:any=resolveConnection(req);
  if(connection.error) return json(connection.status || 400,{error:connection.error});
  const {token,dataSourceId,mode}=connection;

  if(req.method==="POST"){
    let body:any;
    try{ body=await req.json(); }
    catch{ return json(400,{error:"요청 형식이 올바르지 않습니다."}); }

    const pageId=String(body.pageId || "").trim();
    const nextStatus=String(body.status || "").trim();
    if(!validPageId(pageId)) return json(400,{error:"업무 연결 정보가 올바르지 않습니다."});
    if(!ALLOWED_STATUSES.has(nextStatus)) return json(400,{error:"변경할 상태가 올바르지 않습니다."});

    try{
      const previousStatus=await getPageStatus(token,pageId);
      if(!ALLOWED_STATUSES.has(previousStatus)) return json(409,{error:"현재 업무 상태를 확인할 수 없습니다."});
      if(previousStatus!==nextStatus) await setPageStatus(token,pageId,nextStatus);
      return json(200,{ok:true,pageId,previousStatus,status:nextStatus,mode});
    }catch(error:any){
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

    const briefing=await enrichTopStatuses(token,sanitizeSnapshot(parsed));
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
