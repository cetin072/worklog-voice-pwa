import type { Config, Context } from "@netlify/functions";

const NOTION_VERSION = "2026-03-11";
const DEFAULT_DATA_SOURCE_ID = "e345d19d-504f-4466-815a-912b1d6b9a3a";
const MAX_PAGES = 300;

type WorkItem = {
  id:string;
  url:string;
  title:string;
  institution:string;
  status:string;
  type:string;
  recordDate:string;
  dueDate:string;
  followUp:string;
  content:string;
  createdTime:string;
  score:number;
  reason:string;
};

function json(status:number, body:Record<string,unknown>){
  return new Response(JSON.stringify(body), {
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store"
    }
  });
}

function seoulDate(input:Date|string|number = new Date()){
  const d=input instanceof Date ? input : new Date(input);
  const parts=new Intl.DateTimeFormat("en-CA",{
    timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(d);
  const m=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return `${m.year}-${m.month}-${m.day}`;
}

function addDays(day:string, amount:number){
  const d=new Date(`${day}T12:00:00+09:00`);
  d.setUTCDate(d.getUTCDate()+amount);
  return seoulDate(d);
}

function daysBetween(from:string,to:string){
  const a=new Date(`${from}T00:00:00+09:00`).getTime();
  const b=new Date(`${to}T00:00:00+09:00`).getTime();
  return Math.round((b-a)/86400000);
}

function dateValue(value:any){
  const start=value?.date?.start;
  if(!start || typeof start!=="string") return "";
  if(!start.includes("T")) return start.slice(0,10);
  return seoulDate(start);
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
  return String(value?.select?.name || "").trim();
}

function scoreItem(item:Omit<WorkItem,"score"|"reason">, today:string){
  let score=0;
  const reasons:string[]=[];
  const due=item.dueDate;

  if(due){
    const diff=daysBetween(today,due);
    if(diff<0){ score+=120; reasons.push(`기한 ${Math.abs(diff)}일 지남`); }
    else if(diff===0){ score+=110; reasons.push("오늘 기한/일정"); }
    else if(diff===1){ score+=90; reasons.push("내일 일정 준비"); }
    else if(diff<=7){ score+=70-diff; reasons.push(`${diff}일 후 일정`); }
    else if(diff<=14){ score+=45; reasons.push(`${diff}일 후 일정`); }
  }

  if(item.status==="확인필요"){ score+=65; reasons.push("확인 필요"); }
  else if(item.status==="진행중"){ score+=45; reasons.push("진행 중"); }
  else if(item.status==="대기"){ score+=35; reasons.push("대기 중"); }

  if(item.followUp){ score+=25; reasons.push("후속조치 있음"); }
  if(item.type==="회의·통화" && due){ score+=10; }
  if(item.type==="할 일"){ score+=8; }
  if(item.recordDate===today){ score+=8; }

  return {score, reason:reasons.slice(0,2).join(" · ") || "미완료 업무"};
}

function toItem(page:any,today:string):WorkItem|null{
  const p=page?.properties || {};
  const status=selectValue(p["상태"]);
  if(status==="완료") return null;

  const base={
    id:String(page?.id || ""),
    url:String(page?.url || ""),
    title:titleValue(p["업무명"]) || "제목 없는 업무",
    institution:selectValue(p["기관"]) || "미지정",
    status:status || "미지정",
    type:selectValue(p["유형"]) || "기타",
    recordDate:dateValue(p["기록일"]),
    dueDate:dateValue(p["기한"]),
    followUp:textValue(p["후속조치"]),
    content:textValue(p["내용"]),
    createdTime:String(page?.created_time || "")
  };
  const ranked=scoreItem(base,today);
  return {...base,...ranked};
}

async function queryOpenPages(token:string,dataSourceId:string){
  const pages:any[]=[];
  let cursor:string|undefined;

  while(pages.length<MAX_PAGES){
    const payload:any={
      page_size:100,
      filter:{property:"상태",select:{does_not_equal:"완료"}}
    };
    if(cursor) payload.start_cursor=cursor;

    const res=await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`,{
      method:"POST",
      headers:{
        "Authorization":`Bearer ${token}`,
        "Content-Type":"application/json",
        "Notion-Version":NOTION_VERSION
      },
      body:JSON.stringify(payload)
    });
    const data:any=await res.json().catch(()=>({}));
    if(!res.ok){
      console.error("Notion briefing query error",res.status,data);
      throw new Error(`NOTION_${res.status}`);
    }

    if(Array.isArray(data.results)) pages.push(...data.results);
    if(!data.has_more || !data.next_cursor) break;
    cursor=data.next_cursor;
  }

  return pages.slice(0,MAX_PAGES);
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
    const today=seoulDate();
    const tomorrow=addDays(today,1);
    const in14=addDays(today,14);
    const raw=await queryOpenPages(token,dataSourceId);
    const items=raw.map(page=>toItem(page,today)).filter(Boolean) as WorkItem[];

    items.sort((a,b)=>b.score-a.score || (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31") || b.createdTime.localeCompare(a.createdTime));

    const top=items.slice(0,5);
    const todayItems=items.filter(item=>item.dueDate===today).sort((a,b)=>b.score-a.score);
    const upcoming=items
      .filter(item=>item.dueDate && item.dueDate>=tomorrow && item.dueDate<=in14)
      .sort((a,b)=>a.dueDate.localeCompare(b.dueDate) || b.score-a.score)
      .slice(0,8);

    const counts={
      totalOpen:items.length,
      overdue:items.filter(item=>item.dueDate && item.dueDate<today).length,
      today:todayItems.length,
      checking:items.filter(item=>item.status==="확인필요").length
    };

    return json(200,{
      ok:true,
      today,
      generatedAt:new Date().toISOString(),
      top,
      todayItems,
      upcoming,
      counts
    });
  }catch(error:any){
    console.error(error);
    return json(502,{error:"Notion 업무를 불러와 브리핑을 만들지 못했습니다."});
  }
};

export const config:Config={
  path:"/api/briefing",
  method:["GET"]
};
