import type { Config, Context } from "@netlify/functions";
import { createSupabaseDataCoreRestClient } from "../shared/data-core/supabase-rest-client.mjs";
import { createSupabaseWorkspaceContextResolver } from "../shared/platform/supabase-workspace-context.mjs";
import { createWorklogDataCoreBriefingNote } from "../shared/worklog-data-core-briefing-note.mjs";

function json(status:number,body:Record<string,unknown>){
  return new Response(JSON.stringify(body),{
    status,
    headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
  });
}

function enabled(){
  return String(Netlify.env.get("WORKLOG_DATA_CORE_BRIEFING_MUTATION_ENABLED") || "").trim().toLowerCase()==="true";
}

function bearerToken(req:Request){
  const match=/^Bearer\s+(.+)$/i.exec(String(req.headers.get("authorization") || ""));
  return match ? match[1].trim() : "";
}

function rpcUnavailable(error:any){
  if(error?.code!=="SUPABASE_DATA_CORE_RPC_FAILED") return false;
  const message=String(error?.message || "");
  return /(?:could not find|schema cache)[\s\S]*update_my_note_briefing_state/i.test(message)
    || /update_my_note_briefing_state[\s\S]*(?:could not find|schema cache)/i.test(message);
}

export default async (req:Request,_context:Context)=>{
  if(req.method!=="POST") return json(405,{error:"허용되지 않은 요청입니다."});
  if(!enabled()) return json(405,{error:"Data Core 브리핑 상태 변경이 활성화되지 않았습니다."});

  const accessToken=bearerToken(req);
  if(!accessToken) return json(401,{error:"Platform 로그인이 필요합니다."});

  const supabaseUrl=Netlify.env.get("SUPABASE_URL");
  const publishableKey=Netlify.env.get("SUPABASE_PUBLISHABLE_KEY");
  if(!supabaseUrl || !publishableKey) return json(503,{error:"Data Core 브리핑 설정이 아직 준비되지 않았습니다."});

  let body:any;
  try{ body=await req.json(); }catch{ return json(400,{error:"요청 형식이 올바르지 않습니다."}); }

  try{
    const client=createSupabaseDataCoreRestClient({supabaseUrl,publishableKey,accessToken});
    const noteWriter=createWorklogDataCoreBriefingNote({client});
    const resolver=createSupabaseWorkspaceContextResolver({supabaseUrl,publishableKey});

    try{
      const result=await noteWriter.updateStateFast({recordId:body.recordId,state:body.state});
      return json(200,{ok:true,mode:"data_core",...result,dataCoreFastPath:true});
    }catch(fastError:any){
      if(
        fastError?.code==="WORKLOG_DATA_CORE_NOTE_RECORD_ID_INVALID"
        || fastError?.code==="WORKLOG_DATA_CORE_NOTE_STATE_INVALID"
        || fastError?.code==="WORKLOG_DATA_CORE_NOTE_NOT_FOUND_OR_FORBIDDEN"
      ) throw fastError;
      if(!rpcUnavailable(fastError)) throw fastError;
      console.warn("Data Core note fast RPC unavailable; using creator-scoped REST fallback",String(fastError?.message || "unknown").slice(0,120));
    }

    const workspaceContext=await resolver.resolve(accessToken);
    const result=await noteWriter.updateState({recordId:body.recordId,state:body.state},workspaceContext);
    return json(200,{ok:true,mode:"data_core",...result,dataCoreFastPath:false});
  }catch(error:any){
    if(error?.code==="SUPABASE_WORKSPACE_AUTH_FAILED" || error?.code==="SUPABASE_WORKSPACE_ACCESS_TOKEN_REQUIRED"){
      return json(401,{error:"Platform 로그인 세션을 확인하지 못했습니다. 다시 로그인한 뒤 처리해주세요."});
    }
    if(error?.code==="WORKLOG_DATA_CORE_NOTE_RECORD_ID_INVALID" || error?.code==="WORKLOG_DATA_CORE_NOTE_STATE_INVALID"){
      return json(400,{error:error.message});
    }
    if(error?.code==="WORKLOG_DATA_CORE_NOTE_NOT_FOUND_OR_FORBIDDEN"){
      return json(404,{error:error.message});
    }
    console.error("Data Core briefing note error",String(error?.code || "unknown"),String(error?.message || "unknown").slice(0,160));
    return json(502,{error:"메모·참고 상태를 변경하지 못했습니다."});
  }
};

export const config:Config={
  path:"/api/briefing-note",
  method:["POST"]
};
