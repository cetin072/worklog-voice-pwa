import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register('./helpers/mobile-ts-loader.mjs', import.meta.url, {data:{mocks:{'@netlify/blobs':`data:text/javascript,${encodeURIComponent('export const getStore=()=>({get:async()=>null,setJSON:async()=>{}});export const getDeployStore=getStore;')}`}}});
const {default:handler}=await import('../netlify/functions/briefing-v2.mts');
test('stale plain completion of repeat parent returns actionable 409 without legacy fallback',async()=>{
 const oldFetch=globalThis.fetch,oldNetlify=globalThis.Netlify;
 const calls=[];
 globalThis.Netlify={env:{get:key=>({WORKLOG_DATA_CORE_BRIEFING_ENABLED:'true',WORKLOG_DATA_CORE_BRIEFING_MUTATION_ENABLED:'true',SUPABASE_URL:'https://synthetic.invalid',SUPABASE_PUBLISHABLE_KEY:'synthetic-key',WORKLOG_DATA_SCHEMA:'worklog'})[key]}};
 globalThis.fetch=async(input)=>{const url=new URL(input);calls.push(url.pathname);assert.equal(url.origin,'https://synthetic.invalid');assert.equal(url.pathname,'/rest/v1/rpc/update_my_work_record_status');return Response.json({code:'P0001',message:'REPEATING_WORK_USE_OCCURRENCE: 반복 업무는 회차 상세에서 처리해주세요.'},{status:400});};
 try{
  const response=await handler(new Request('https://synthetic.invalid/api/briefing-v2',{method:'POST',headers:{authorization:'Bearer synthetic-token','content-type':'application/json'},body:JSON.stringify({recordId:'11111111-1111-4111-8111-111111111111',status:'완료'})}),{});
  assert.equal(response.status,409);assert.match((await response.json()).error,/반복 업무.*회차/);assert.equal(calls.length,1);
 }finally{globalThis.fetch=oldFetch;globalThis.Netlify=oldNetlify;}
});
