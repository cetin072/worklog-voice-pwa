import type { Config, Context } from '@netlify/functions';
import { createSupabaseDataCoreRestClient } from '../shared/data-core/supabase-rest-client.mjs';
import { deferScheduleTime } from '../shared/schedule-defer-reminder.mjs';

function json(status:number, body:Record<string,unknown>){ return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}}); }
function bearer(req:Request){ const m=/^Bearer\s+(.+)$/i.exec(String(req.headers.get('authorization')||'')); return m?.[1]?.trim()||''; }

export default async (req:Request,_context:Context)=>{
  if(req.method!=='POST') return json(405,{error:'허용되지 않은 요청입니다.'});
  const accessToken=bearer(req);
  if(!accessToken) return json(401,{error:'로그인이 필요합니다.'});
  const supabaseUrl=Netlify.env.get('SUPABASE_URL');
  const publishableKey=Netlify.env.get('SUPABASE_PUBLISHABLE_KEY');
  if(!supabaseUrl||!publishableKey) return json(503,{error:'Data Core 설정이 준비되지 않았습니다.'});
  let body:any; try{body=await req.json();}catch{return json(400,{error:'요청 형식이 올바르지 않습니다.'});}
  try{
    const preset=String(body?.preset||'');
    const newStartsAt=deferScheduleTime(body?.startsAt,preset,body?.customStartsAt);
    const client=createSupabaseDataCoreRestClient({supabaseUrl,publishableKey,accessToken});
    const rows=await client.rpc('defer_my_schedule',{p_schedule_id:String(body?.scheduleId||''),p_new_starts_at:newStartsAt,p_preset:preset});
    const result=Array.isArray(rows)?rows[0]:rows;
    if(!result) return json(404,{error:'일정을 찾지 못했습니다.'});
    return json(200,{ok:true,schedule:result});
  }catch(error:any){
    const code=String(error?.code||'');
    if(code.includes('INVALID')||code.includes('REQUIRED')) return json(400,{error:error.message});
    console.error('schedule defer failed',code,String(error?.message||'').slice(0,160));
    return json(502,{error:'일정을 미루지 못했습니다.'});
  }
};
export const config:Config={path:'/api/schedule-defer',method:['POST']};
