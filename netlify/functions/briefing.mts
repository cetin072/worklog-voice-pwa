import type { Config, Context } from "@netlify/functions";

const NOTION_VERSION = "2026-03-11";
const DEFAULT_DATA_SOURCE_ID = "e345d19d-504f-4466-815a-912b1d6b9a3a";
const BRIEFING_PROJECT = "SYSTEM_DAILY_BRIEFING";

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

async function querySnapshot(token:string,dataSourceId:string){
  const res=await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`,{
    method:"POST",
    headers:{
      "Authorization":`Bearer ${token}`,
      "Content-Type":"application/json",
      "Notion-Version":NOTION_VERSION
    },
    body:JSON.stringify({
      page_size:10,
      filter:{property:"프로젝트",rich_text:{equals:BRIEFING_PROJECT}},
      sorts:[{timestamp:"last_edited_time",direction:"descending"}]
    })
  });

  const data:any=await res.json().catch(()=>({}));
  if(!res.ok){
    console.error("Notion briefing snapshot query error",res.status,data);
    throw new Error(`NOTION_${res.status}`);
  }

  return Array.isArray(data.results) ? data.results[0] : null;
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
      institution:String(item?.institution || "")
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
      const [,title="",note="",institution=""]=line.split("|");
      if(title.trim()) parsed.top.push({title:title.trim(),note:note.trim(),institution:institution.trim()});
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
  if(req.method!=="GET") return json(405,{error:"허용되지 않은 요청입니다."});

  const token=Netlify.env.get("NOTION_TOKEN");
  const accessKey=Netlify.env.get("APP_ACCESS_KEY");
  const dataSourceId=Netlify.env.get("NOTION_DATA_SOURCE_ID") || DEFAULT_DATA_SOURCE_ID;

  if(!token) return json(500,{error:"NOTION_TOKEN이 설정되지 않았습니다."});
  if(!accessKey) return json(500,{error:"APP_ACCESS_KEY가 설정되지 않았습니다."});
  if((req.headers.get("x-worklog-key")||"")!==accessKey) return json(401,{error:"개인 접근키가 올바르지 않습니다."});

  try{
    const page=await querySnapshot(token,dataSourceId);
    if(!page) return json(200,{ok:true,ready:false,message:"아직 생성된 일일 브리핑이 없습니다."});

    const rawText=textValue(page?.properties?.["내용"]);
    if(!rawText || rawText==="브리핑 준비 중"){
      return json(200,{ok:true,ready:false,message:"첫 예약 브리핑 생성 전입니다."});
    }

    const parsed=parseStoredSnapshot(rawText);
    if(!parsed){
      console.error("Invalid briefing snapshot",rawText.slice(0,300));
      return json(502,{error:"저장된 일일 브리핑 형식이 올바르지 않습니다."});
    }

    return json(200,{ok:true,ready:true,briefing:sanitizeSnapshot(parsed)});
  }catch(error){
    console.error(error);
    return json(502,{error:"최신 일일 브리핑을 불러오지 못했습니다."});
  }
};

export const config:Config={
  path:"/api/briefing",
  method:["GET"]
};
