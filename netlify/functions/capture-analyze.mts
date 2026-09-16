import type {Context} from "@netlify/functions";
import {analyzeCaptureText} from "../shared/capture-analysis.mjs";
import {createSupabaseWorkspaceContextResolver} from "../shared/platform/supabase-workspace-context.mjs";

function json(status:number,body:Record<string,unknown>){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8"}});}
function bearerToken(req:Request){const match=/^Bearer\s+(.+)$/i.exec(String(req.headers.get("authorization")||""));return match?match[1].trim():"";}

export default async(req:Request,_context:Context)=>{
  if(req.method!=="POST")return json(405,{error:"허용되지 않은 요청입니다."});
  const accessToken=bearerToken(req);if(!accessToken)return json(401,{error:"로그인 후 캡처를 분석해주세요."});
  const supabaseUrl=Netlify.env.get("SUPABASE_URL"),publishableKey=Netlify.env.get("SUPABASE_PUBLISHABLE_KEY");
  if(!supabaseUrl||!publishableKey)return json(503,{error:"캡처 분석 인증 설정이 준비되지 않았습니다."});
  try{await createSupabaseWorkspaceContextResolver({supabaseUrl,publishableKey}).resolve(accessToken);}catch{return json(401,{error:"로그인 세션을 확인하지 못했습니다. 다시 로그인해주세요."});}
  let body:any;try{body=await req.json();}catch{return json(400,{error:"요청 형식이 올바르지 않습니다."});}
  const text=String(body?.text||"").trim();if(!text)return json(400,{error:"분석할 캡처 글자가 없습니다."});if(text.length>6000)return json(400,{error:"캡처 글자는 6,000자 이하로 확인해주세요."});
  return json(200,{ok:true,analysis:analyzeCaptureText(text,body?.recordedAt||new Date())});
};
