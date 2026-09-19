import type { Config, Context } from "@netlify/functions";
import { createSupabaseDataCoreRestClient } from "../shared/data-core/supabase-rest-client.mjs";
import { createWorklogJournalReader } from "../shared/worklog-journal-reader.mjs";

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

export default async (req:Request,_context:Context)=>{
  if(req.method!=="GET") return json(405,{error:"허용되지 않은 요청입니다."});

  const accessToken=bearerToken(req);
  if(!accessToken) return json(401,{error:"Platform 로그인이 필요합니다."});

  const date=String(new URL(req.url).searchParams.get("date") || "").trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(400,{error:"업무일지 날짜가 올바르지 않습니다."});

  const supabaseUrl=Netlify.env.get("SUPABASE_URL");
  const publishableKey=Netlify.env.get("SUPABASE_PUBLISHABLE_KEY");
  if(!supabaseUrl || !publishableKey) return json(503,{error:"업무일지 데이터 설정이 아직 준비되지 않았습니다."});

  try{
    const client=createSupabaseDataCoreRestClient({supabaseUrl,publishableKey,accessToken});
    const journal=await createWorklogJournalReader({client}).load(date);
    return json(200,{ok:true,mode:"data_core",...journal});
  }catch(error:any){
    if(error?.code==="WORKLOG_JOURNAL_DATE_INVALID") return json(400,{error:error.message});
    if(error?.code==="SUPABASE_DATA_CORE_RPC_FAILED" && /get_my_work_journal_day|schema cache|function/i.test(String(error?.message || ""))){
      return json(503,{error:"자동 업무일지 기능을 준비하고 있습니다. 잠시 후 다시 시도해주세요."});
    }
    console.error("Work journal error",String(error?.code || "unknown"),String(error?.message || "unknown").slice(0,160));
    return json(502,{error:"업무일지를 불러오지 못했습니다."});
  }
};

export const config:Config={
  path:"/api/work-journal",
  method:["GET"]
};
