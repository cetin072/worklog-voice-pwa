import type { Config, Context } from "@netlify/functions";

const NOTION_VERSION = "2026-03-11";

function json(status:number, body:Record<string,unknown>){
  return new Response(JSON.stringify(body),{
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store"
    }
  });
}

function notionHeaders(token:string){
  return {
    "Authorization":`Bearer ${token}`,
    "Content-Type":"application/json",
    "Notion-Version":NOTION_VERSION
  };
}

function richText(value:string){
  return {rich_text:value ? [{type:"text",text:{content:value.slice(0,2000)}}] : []};
}

function title(value:string){
  return {title:[{type:"text",text:{content:value.slice(0,160)}}]};
}

function unique(values:string[]){
  return [...new Set(values.map(v=>v.trim()).filter(Boolean))];
}

async function notionRequest(token:string,url:string,init:RequestInit={}){
  const res=await fetch(url,{
    ...init,
    headers:{...notionHeaders(token),...(init.headers || {})}
  });
  const data:any=await res.json().catch(()=>({}));
  if(!res.ok){
    const message=String(data?.message || data?.code || `Notion ${res.status}`);
    throw new Error(`${res.status}:${message}`);
  }
  return data;
}

export default async (req:Request,_context:Context)=>{
  if(req.method!=="POST") return json(405,{error:"허용되지 않은 요청입니다."});

  let body:any;
  try{ body=await req.json(); }
  catch{ return json(400,{error:"요청 형식이 올바르지 않습니다."}); }

  const token=String(body.token || "").trim();
  const organization=String(body.organization || "회사").replace(/[|\n\r]/g," ").trim().slice(0,60) || "회사";

  if(!token) return json(400,{error:"Notion 개인 액세스 토큰을 입력해주세요."});
  if(token.length>300) return json(400,{error:"토큰 형식이 올바르지 않습니다."});

  try{
    const me=await notionRequest(token,"https://api.notion.com/v1/users/me",{method:"GET"});

    const root=await notionRequest(token,"https://api.notion.com/v1/pages",{
      method:"POST",
      body:JSON.stringify({
        icon:{type:"emoji",emoji:"📒"},
        markdown:[
          "# 업무수첩",
          "",
          "업무수첩에서 사용하는 Notion 항목을 한곳에 모아 관리하는 상위 페이지입니다.",
          "",
          "아래 하위 항목은 업무수첩이 자동으로 사용합니다."
        ].join("\n")
      })
    });

    const institutions=unique([organization,"개인","기타"]);
    const database=await notionRequest(token,"https://api.notion.com/v1/databases",{
      method:"POST",
      body:JSON.stringify({
        parent:{type:"page_id",page_id:root.id},
        title:[{type:"text",text:{content:"🎙 업무 통합 기록"}}],
        description:[{type:"text",text:{content:"업무기록 앱이 사용하는 개인 업무 원장"}}],
        is_inline:false,
        initial_data_source:{
          properties:{
            "업무명":{title:{}},
            "기관":{select:{options:institutions.map((name,index)=>({name,color:["blue","green","gray"][index] || "gray"}))}},
            "기록일":{date:{}},
            "기한":{date:{}},
            "내용":{rich_text:{}},
            "담당자":{rich_text:{}},
            "상태":{select:{options:[
              {name:"완료",color:"green"},
              {name:"진행중",color:"blue"},
              {name:"대기",color:"yellow"},
              {name:"확인필요",color:"red"}
            ]}},
            "유형":{select:{options:[
              {name:"완료업무",color:"green"},
              {name:"할 일",color:"blue"},
              {name:"회의·통화",color:"purple"},
              {name:"지출·세무",color:"orange"},
              {name:"지시·위임",color:"yellow"},
              {name:"아이디어",color:"pink"},
              {name:"문제·확인",color:"red"},
              {name:"기타",color:"gray"}
            ]}},
            "금액":{number:{}},
            "후속조치":{rich_text:{}},
            "프로젝트":{rich_text:{}},
            "증빙":{select:{options:[
              {name:"미첨부",color:"yellow"},
              {name:"첨부완료",color:"green"},
              {name:"해당없음",color:"gray"}
            ]}},
            "음성원문":{rich_text:{}},
            "생성일":{created_time:{}}
          }
        }
      })
    });

    let dataSourceId=String(database?.data_sources?.[0]?.id || "");
    if(!dataSourceId){
      const retrieved=await notionRequest(token,`https://api.notion.com/v1/databases/${database.id}`,{method:"GET"});
      dataSourceId=String(retrieved?.data_sources?.[0]?.id || "");
    }
    if(!dataSourceId) throw new Error("500:생성된 Notion data source를 찾지 못했습니다.");

    const briefing=await notionRequest(token,"https://api.notion.com/v1/pages",{
      method:"POST",
      body:JSON.stringify({
        parent:{type:"data_source_id",data_source_id:dataSourceId},
        properties:{
          "업무명":title("[시스템] 현재 일일 브리핑"),
          "기관":{select:{name:"기타"}},
          "기록일":{date:{start:new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul"}).format(new Date())}},
          "내용":richText("브리핑 준비 중"),
          "상태":{select:{name:"완료"}},
          "유형":{select:{name:"기타"}},
          "프로젝트":richText("SYSTEM_DAILY_BRIEFING"),
          "증빙":{select:{name:"해당없음"}}
        }
      })
    });

    return json(200,{
      ok:true,
      workspaceName:String(me?.name || me?.bot?.workspace_name || "Notion"),
      organization,
      rootPageId:root.id,
      rootUrl:root.url,
      databaseId:database.id,
      databaseUrl:database.url,
      dataSourceId,
      briefingPageId:briefing.id
    });
  }catch(error:any){
    const raw=String(error?.message || "");
    const [statusText,...rest]=raw.split(":");
    const notionStatus=Number(statusText);
    const detail=rest.join(":");

    if(notionStatus===401) return json(401,{error:"Notion 토큰이 올바르지 않습니다. 새 토큰을 만들어 다시 입력해주세요."});
    if(notionStatus===403) return json(403,{error:"이 토큰에 Notion API 권한이 없습니다. 토큰 생성 시 Notion API 기능을 허용했는지 확인해주세요."});

    console.error("Personal Notion setup failed",Number.isFinite(notionStatus) ? notionStatus : "unknown",detail.slice(0,300));
    return json(502,{error:"Notion 개인 업무 공간을 자동으로 만들지 못했습니다. 토큰 권한을 확인한 뒤 다시 시도해주세요."});
  }
};

export const config:Config={
  path:"/api/setup",
  method:["POST"]
};
