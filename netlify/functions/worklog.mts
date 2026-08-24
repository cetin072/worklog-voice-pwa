import type { Config, Context } from "@netlify/functions";

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
function richText(v:string){
  return { rich_text: v ? [{type:"text",text:{content:v.slice(0,2000)}}] : [] };
}
function title(v:string){
  return { title:[{type:"text",text:{content:v.slice(0,160)}}] };
}
function makeTitle(v:string){
  const s=v.replace(/\s+/g," ").trim();
  return s.length<=60 ? s : `${s.slice(0,57)}…`;
}
function seoulDate(input?:string){
  const d=input ? new Date(input) : new Date();
  const parts=new Intl.DateTimeFormat("en-CA",{
    timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(d);
  const m=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return `${m.year}-${m.month}-${m.day}`;
}

export default async (req:Request, _context:Context) => {
  const token = Netlify.env.get("NOTION_TOKEN");
  const accessKey = Netlify.env.get("APP_ACCESS_KEY");
  const dataSourceId = Netlify.env.get("NOTION_DATA_SOURCE_ID") || DEFAULT_DATA_SOURCE_ID;

  if(req.method==="GET"){
    return json(200,{
      ok:true,
      configured:Boolean(token && accessKey && dataSourceId)
    });
  }

  if(req.method!=="POST") return json(405,{error:"허용되지 않은 요청입니다."});
  if(!token) return json(500,{error:"NOTION_TOKEN이 설정되지 않았습니다."});
  if(!accessKey) return json(500,{error:"APP_ACCESS_KEY가 설정되지 않았습니다."});
  if((req.headers.get("x-worklog-key")||"")!==accessKey) return json(401,{error:"개인 접근키가 올바르지 않습니다."});

  let body:any;
  try{ body=await req.json(); }catch{ return json(400,{error:"요청 형식이 올바르지 않습니다."}); }

  const transcript=String(body.transcript||"").trim();
  if(!transcript) return json(400,{error:"업무 내용이 비어 있습니다."});
  if(transcript.length>1800) return json(400,{error:"업무 내용은 1,800자 이하로 입력해주세요."});

  const institution=INSTITUTIONS.has(body.institution) ? body.institution : "기타";
  const status=STATUSES.has(body.status) ? body.status : "진행중";
  const type=TYPES.has(body.type) ? body.type : "기타";

  const properties:any = {
    "업무명": title(makeTitle(transcript)),
    "기관": {select:{name:institution}},
    "상태": {select:{name:status}},
    "유형": {select:{name:type}},
    "기록일": {date:{start:seoulDate(body.recordedAt)}},
    "내용": richText(transcript),
    "음성원문": richText(transcript),
    "증빙": {select:{name:type==="지출·세무" ? "미첨부" : "해당없음"}}
  };

  if(typeof body.amount==="number" && Number.isFinite(body.amount)) properties["금액"]={number:body.amount};
  if(String(body.assignee||"").trim()) properties["담당자"]=richText(String(body.assignee).trim());
  if(String(body.followUp||"").trim()) properties["후속조치"]=richText(String(body.followUp).trim());
  if(body.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)) properties["기한"]={date:{start:body.dueDate}};

  try{
    const res=await fetch("https://api.notion.com/v1/pages",{
      method:"POST",
      headers:{
        "Authorization":`Bearer ${token}`,
        "Content-Type":"application/json",
        "Notion-Version":NOTION_VERSION
      },
      body:JSON.stringify({
        parent:{type:"data_source_id",data_source_id:dataSourceId},
        properties
      })
    });

    const data:any=await res.json().catch(()=>({}));
    if(!res.ok){
      console.error("Notion error",res.status,data);
      return json(502,{error:"Notion 저장에 실패했습니다. 토큰과 DB 연결 권한을 확인해주세요.", notionStatus:res.status});
    }
    return json(200,{ok:true,pageId:data.id,url:data.url});
  }catch(err){
    console.error(err);
    return json(502,{error:"Notion 서버에 연결하지 못했습니다."});
  }
};

export const config:Config = {
  path:"/api/worklog",
  method:["GET","POST"]
};
