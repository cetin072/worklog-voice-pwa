import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { confirmWorklogReminder, findWorklogReminder } = await import('../mobile/src/features/schedule/worklog-reminder-adapter.ts');
const SID='11111111-1111-4111-8111-111111111111', UID='22222222-2222-4222-8222-222222222222';
const row={id:SID,created_by_user_id:UID,title:'진주IC',starts_at:'2099-01-01T09:00:00+09:00',status:'confirmed',all_day:false,updated_at:'2026-10-24T00:00:00Z'};
function client({ error=null, rows=[row], count=rows.length, discovery=[{id:SID}], rpcData=[{schedule_id:SID}] }={}) {
  const calls=[];
  return { calls, auth:{async getUser(){return {data:{user:{id:UID}}};}}, async rpc(name,args){calls.push([name,args]);return {data:rpcData,error};}, from(){return {select(){return {eq(){return {async or(){return {data:discovery,count:discovery.length,error};}};},in(){return {async eq(){return {data:rows,count,error};}};}};}};}};
}
test('explicit confirmation calls only atomic RPC then reads canonical snapshot', async()=>{
 const c=client(); const result=await confirmWorklogReminder(c,SID,row.starts_at,()=>true);
 assert.equal(result.id,SID); assert.equal(c.calls.length,1); assert.equal(c.calls[0][0],'confirm_my_worklog_reminder');
});
test('RPC unavailable and partial response fail closed',async()=>{
 await assert.rejects(confirmWorklogReminder(client({error:new Error('PGRST202')}),SID,row.starts_at,()=>true),/PGRST202/);
 await assert.rejects(confirmWorklogReminder(client({rpcData:[]}),SID,row.starts_at,()=>true),/INVALID/);
 await assert.rejects(confirmWorklogReminder(client({count:2}),SID,row.starts_at,()=>true),/INCOMPLETE/);
});
test('wrong account row and stale response cannot become a usable reminder',async()=>{
 await assert.rejects(findWorklogReminder(client({rows:[{...row,created_by_user_id:SID}]}),{scheduleId:SID,title:'test'},()=>true),/INVALID/);
 const c=client(); let active=true; const original=c.rpc; c.rpc=async(...args)=>{const result=await original(...args);active=false;return result;};
 await assert.rejects(confirmWorklogReminder(c,SID,row.starts_at,()=>active),/STALE/);
});
test('empty complete discovery requires explicit confirmation; missing exact ID is not absence authorization',async()=>{
 assert.equal(await findWorklogReminder(client({discovery:[]}),{recordId:SID,title:'test'},()=>true),null);
 await assert.rejects(findWorklogReminder(client({rows:[]}),{scheduleId:SID,title:'test'},()=>true),/INCOMPLETE/);
});
