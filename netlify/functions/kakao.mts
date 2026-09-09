import type { Config, Context } from "@netlify/functions";
import {
  beginKakaoAuthorization,
  disconnectKakao,
  finishKakaoAuthorization,
  getKakaoStatus,
  sendCurrentBriefing
} from "../shared/kakao.mts";

function json(status:number,body:Record<string,unknown>){
  return new Response(JSON.stringify(body),{
    status,
    headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
  });
}

function ownerAuthorized(req:Request){
  const expected=(Netlify.env.get("APP_ACCESS_KEY") || "").trim();
  if(!expected) return {ok:false,status:500,error:"APP_ACCESS_KEY가 설정되지 않았습니다."};
  if((req.headers.get("x-worklog-key") || "")!==expected){
    return {ok:false,status:401,error:"개인 접근키가 올바르지 않습니다."};
  }
  return {ok:true,status:200,error:""};
}

function siteUrl(){
  return (Netlify.env.get("URL") || "https://worklog-voice-pwa.netlify.app").replace(/\/$/,"");
}

function isProductionRequest(requestUrl:string){
  try{
    return new URL(requestUrl).host===new URL(siteUrl()).host;
  }catch{
    return false;
  }
}

function errorMessage(error:unknown){
  const code=String((error as any)?.message || "");
  const known:Record<string,string>={
    KAKAO_PRODUCTION_ONLY:"카카오 연결과 전송은 운영판에서만 사용할 수 있습니다.",
    KAKAO_NOT_CONFIGURED:"카카오 앱 설정이 아직 완료되지 않았습니다.",
    KAKAO_NOT_LINKED:"카카오 계정을 먼저 연결해주세요.",
    KAKAO_STATE_INVALID:"카카오 연결 요청이 만료되었습니다. 다시 연결해주세요.",
    KAKAO_TOKEN_FAILED:"카카오 로그인 토큰을 발급받지 못했습니다.",
    KAKAO_REFRESH_FAILED:"카카오 연결 갱신에 실패했습니다. 다시 연결해주세요.",
    KAKAO_SEND_FAILED:"카카오톡 전송에 실패했습니다.",
    BRIEFING_NOT_READY:"전송할 브리핑이 아직 준비되지 않았습니다."
  };
  return known[code] || "카카오톡 처리 중 오류가 발생했습니다.";
}

export default async (req:Request,_context:Context)=>{
  const url=new URL(req.url);
  const production=isProductionRequest(req.url);
  const isCallback=url.pathname.endsWith("/callback");

  if(isCallback){
    const error=url.searchParams.get("error");
    const code=url.searchParams.get("code") || "";
    const state=url.searchParams.get("state") || "";
    if(error || !code || !state){
      return Response.redirect(`${siteUrl()}/?kakao=error`,302);
    }
    try{
      await finishKakaoAuthorization(code,state,production);
      return Response.redirect(`${siteUrl()}/?kakao=connected`,302);
    }catch(error){
      console.error("Kakao callback error",String((error as any)?.message || "unknown").slice(0,120));
      return Response.redirect(`${siteUrl()}/?kakao=error`,302);
    }
  }

  const auth=ownerAuthorized(req);
  if(!auth.ok) return json(auth.status,{error:auth.error});

  try{
    if(req.method==="GET"){
      const status=await getKakaoStatus(production);
      return json(200,{ok:true,...status});
    }

    if(req.method!=="POST") return json(405,{error:"지원하지 않는 요청입니다."});
    const body:any=await req.json().catch(()=>({}));
    const action=String(body?.action || "");

    if(action==="authorize"){
      const authorizeUrl=await beginKakaoAuthorization(production);
      return json(200,{ok:true,authorizeUrl});
    }
    if(action==="send_current"){
      if(!production) return json(409,{error:"카카오톡 전송은 운영판에서만 사용할 수 있습니다.",reason:"production-only"});
      const result=await sendCurrentBriefing({manual:true});
      if(!result.sent){
        const message=result.reason==="cooldown"
          ? "방금 브리핑을 보냈습니다. 잠시 후 다시 시도해주세요."
          : "현재 브리핑을 전송하지 못했습니다.";
        return json(409,{error:message,reason:result.reason || "unknown"});
      }
      return json(200,{ok:true,...result});
    }
    if(action==="disconnect"){
      if(!production) return json(409,{error:"카카오 연결 해제는 운영판에서만 사용할 수 있습니다."});
      await disconnectKakao();
      return json(200,{ok:true});
    }
    return json(400,{error:"카카오 요청 형식이 올바르지 않습니다."});
  }catch(error){
    console.error("Kakao API error",String((error as any)?.message || "unknown").slice(0,120));
    return json(500,{error:errorMessage(error)});
  }
};

export const config:Config={
  path:["/api/kakao","/api/kakao/callback"]
};
