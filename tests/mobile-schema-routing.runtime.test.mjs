import assert from 'node:assert/strict';import test from 'node:test';import{register}from'node:module';
const storageMock='data:text/javascript,'+encodeURIComponent(`export const reads=[];export const removed=[];export const secureSessionStorage={getItem:async key=>{reads.push(key);return null},setItem:async()=>{},removeItem:async key=>{removed.push(key)}};`);
register('./helpers/mobile-ts-loader.mjs',import.meta.url,{data:{mocks:{'./secure-storage':storageMock,'react-native-url-polyfill/auto':'data:text/javascript,export {}'}}});
const{createPlatformSupabaseClient}=await import('../mobile/src/platform/supabase.ts');
const store=await import(storageMock);
test('actual mobile SDK scopes table/RPC to worklog and reads only the new project session key',async()=>{
 const saved=globalThis.fetch,calls=[];
 globalThis.fetch=async(u,o)=>{calls.push({u:String(u),headers:new Headers(o?.headers)});return Response.json([]);};
 const client=createPlatformSupabaseClient({configured:true,supabaseUrl:'https://newproject.supabase.co',publishableKey:'sb_publishable_fixture',dataCorePrimaryEnabled:true,dataSchema:'worklog'});
 try{
  await client.auth.initialize();await client.from('schedules').select('id');await client.rpc('bootstrap_personal_workspace');
  assert.equal(calls[0].headers.get('Accept-Profile'),'worklog');assert.equal(calls[1].headers.get('Content-Profile'),'worklog');
  assert.ok(store.reads.some(k=>k.startsWith('sb-newproject-auth-token')));assert.ok(!store.reads.some(k=>k.includes('oldproject')));assert.equal(store.removed.length,0);
 }finally{await client.auth.stopAutoRefresh();globalThis.fetch=saved;}
});
