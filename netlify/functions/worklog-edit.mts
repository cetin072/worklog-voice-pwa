import type { Config, Context } from "@netlify/functions";
import { pageBelongsToDataSource } from "../shared/core-logic.mjs";
import { normalizeWorklogTitle, validWorklogPageId } from "../shared/worklog-edit.mjs";

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

function titleValue(value:any){
  const arr=value?.title;
  if(!Array.isArray(arr)) return "";
  return arr.map((item:any)=>item?.plain_text || item?.text?.content || "").join("").trim();
}

function titleProperty(value:string){
  return {title:[{type:"text",text:{content:value}}]};
}

async function getVerifiedPage(token:string,pageId:string,dataSourceId:string){
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
  if(!pageBelongsToDataSource(parentId,dataSourceId)){
    const error:any=new Error("NOTION_PAGE_OUTSIDE_DATA_SOURCE");
    error.status=403;
    throw error;
  }
  return data;
}

async function updateTitle(token:string,pageId:string,title:string){
  const res=await fetch(`https://api.notion.com/v1/pages/${pageId}`,{
    method:"PATCH",
    headers:notionHeaders(token),
    body:JSON.stringify({properties:{"업무명":titleProperty(title)}})
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

export default async (req:Request,_context:Context)=>{
  if(req.method!=="POST") return json(405,{error:"허용되지 않은 요청입니다."});

  const connection:any=resolveConnection(req);
  if(connection.error) return json(connection.status || 400,{error:connection.error});
  const {token,dataSourceId,mode}=connection;

  let body:any;
  try{ body=await req.json(); }
  catch{ return json(400,{error:"요청 형식이 올바르지 않습니다."}); }

  const pageId=String(body.pageId || "").trim();
  const nextTitle=normalizeWorklogTitle(body.title);
  if(!validWorklogPageId(pageId)) return json(400,{error:"수정할 업무 식별자가 올바르지 않습니다."});
  if(!nextTitle) return json(400,{error:"업무명을 입력해주세요."});
  if(nextTitle.length>160) return json(400,{error:"업무명은 160자 이하로 입력해주세요."});

  try{
    const page=await getVerifiedPage(token,pageId,dataSourceId);
    const previousTitle=titleValue(page?.properties?.["업무명"]);
    if(previousTitle===nextTitle){
      return json(200,{ok:true,unchanged:true,pageId,title:nextTitle,mode});
    }

    await updateTitle(token,pageId,nextTitle);
    return json(200,{ok:true,pageId,title:nextTitle,previousTitle,mode});
  }catch(error:any){
    if(error?.status===403) return json(403,{error:"이 업무는 현재 연결된 업무수첩에서 수정할 수 없습니다."});
    if(mode==="personal" && (error?.status===401 || error?.status===404)){
      return json(401,{error:"개인 Notion 연결이 만료되었거나 업무를 찾을 수 없습니다. 다시 연결해주세요."});
    }
    console.error(error);
    return json(502,{error:"Notion 업무명 수정에 실패했습니다."});
  }
};

export const config:Config={
  path:"/api/worklog-edit",
  method:["POST"]
};
