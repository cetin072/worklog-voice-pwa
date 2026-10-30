import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire, register } from 'node:module';
import { captureScheduleInput } from '../netlify/shared/capture-schedule-input.mjs';
register('./helpers/mobile-ts-loader.mjs',import.meta.url);
const {createCaptureInbox}=await import('../mobile/src/features/capture/capture-inbox.ts');
const ts=createRequire(new URL('../mobile/package.json',import.meta.url))('typescript');
function harness() {
 const map=new Map(),remote=new Map(),calls=[],sid='11111111-1111-4111-8111-111111111111';let actor='alice',timeout=false,failOcr=false,switchToken=false,failReminder=false;
 const storage={getItem:async k=>map.get(k)||null,setItem:async(k,v)=>{map.set(k,v);}};
 const client={auth:{getUser:async()=>({data:{user:{id:actor}}})}};
 const modules={
  '../../../../netlify/shared/capture-schedule-input.mjs':{captureScheduleInput},
  '@/src/platform/secure-storage':{secureSessionStorage:storage},'./capture-inbox':{createCaptureInbox},
  '@/src/platform/authenticated-access':{getFreshAccessToken:async()=>{if(switchToken)actor='bob';return actor+'-token';}},
  '@/src/features/schedule/schedule-reminder-snapshot':{reminderSessionEpoch:{capture:()=>()=>true},readOwnedReminderSnapshots:async()=>({rows:[{id:sid,title:'회의',startsAt:'2099-11-03T06:00:00Z',status:'confirmed',allDay:false}]})},
  './capture-files':{removeCaptureImage:async uri=>calls.push(['remove',uri])},
  './capture-ocr':{recognizeCapture:async()=>{if(failOcr)throw Error('OCR');return '2099년 11월 3일 오후 3시 회사에서 회의';}},
  '@/src/platform/worklog-api':{
   saveWorklog:async(token,text,options)=>{calls.push(['save',token,text,options]);if(!remote.has(options.clientRequestId))remote.set(options.clientRequestId,{pageId:'record-a',scheduleCreated:true,scheduleId:sid});if(timeout){timeout=false;throw Error('connection lost after commit');}return remote.get(options.clientRequestId);},
   readWorklogDetails:async()=>({title:'서버 회의 제목',dueDate:'2099-11-03',dueTime:'15:00'}),
   updateWorklogDetails:async(token,input)=>{calls.push(['edit',token,input]);return{title:input.title,schedule:{id:sid,status:'confirmed'}};},
   deleteWorklog:async(_client,id)=>{calls.push(['delete',id]);return{cancelledScheduleIds:[sid]};},
  },
  '@/src/features/schedule/schedule-reminder-post-save':{
   synchronizeSavedScheduleReminders:async result=>{calls.push(['reminders',result]);if(failReminder)throw Error('permission');},
   synchronizeEditedWorklogReminder:async(_c,input)=>calls.push(['edit-reminders',input]),
   cancelSavedScheduleReminders:async ids=>calls.push(['cancel-reminders',ids]),
  },
 };
 const exports={};const code=ts.transpileModule(readFileSync('mobile/src/features/capture/capture-runtime.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require:n=>{assert.ok(modules[n],n);return modules[n];}});
 return{api:exports,client,calls,remote,owner:()=>actor,setTimeout:()=>timeout=true,failOcr:()=>failOcr=true,switchToken:()=>switchToken=true,failReminder:()=>failReminder=true,receive:()=>exports.captureInbox.receive({hash:'a'.repeat(64),uri:'file:///private/capture'},'alice')};
}
test('automatic save has no confirmation; two overlapping runs share the persisted receipt',async()=>{
 const h=harness(),entry=await h.receive();const [a,b]=await Promise.all([h.api.processCapture(entry,h.client,'alice'),h.api.processCapture(entry,h.client,'alice')]);
 assert.equal(a.saved.pageId,b.saved.pageId);assert.equal(h.calls.filter(x=>x[0]==='save').length,1);
 const call=h.calls.find(x=>x[0]==='save');assert.equal(call[3].sourceType,'capture');assert.ok(call[2].includes('약속:'));
 assert.equal(a.details.title,'서버 회의 제목');assert.equal(a.uri,undefined);
});
test('uncertain response retries the exact request ID and creates only one remote record',async()=>{
 const h=harness(),entry=await h.receive();h.setTimeout();await assert.rejects(h.api.processCapture(entry,h.client,'alice'));
 const pending=await h.api.captureInbox.get(entry.hash,'alice');assert.ok(pending.uri);assert.ok(pending.decision);
 await h.api.processCapture(pending,h.client,'alice');const saves=h.calls.filter(x=>x[0]==='save');assert.equal(saves.length,2);assert.equal(saves[0][3].clientRequestId,saves[1][3].clientRequestId);assert.equal(h.remote.size,1);
});
test('post-save edit and undo consume the canonical response and clean related reminders',async()=>{
 const h=harness();let entry=await h.api.processCapture(await h.receive(),h.client,'alice');
 await h.api.editCapture(h.client,entry,{title:'변경된 회의',dueDate:'2099-11-04',dueTime:'16:00'});
 assert.equal(h.calls.find(x=>x[0]==='edit-reminders')[1].dueTime,'16:00');
 entry=await h.api.undoCapture(h.client,entry);assert.equal(entry.undone,true);
 assert.equal(h.calls.find(x=>x[0]==='cancel-reminders')[1][0],'11111111-1111-4111-8111-111111111111');
 await h.api.processCapture(entry,h.client,'alice');assert.equal(h.calls.filter(x=>x[0]==='save').length,1);
});
test('OCR failure retains image and account change before token submission cannot save to another account',async()=>{
 const h=harness(),entry=await h.receive();h.failOcr();await assert.rejects(h.api.processCapture(entry,h.client,'alice'));
 assert.ok((await h.api.captureInbox.get(entry.hash,'alice')).uri);assert.equal(h.calls.length,0);
 const h2=harness(),e2=await h2.receive();h2.switchToken();await assert.rejects(h2.api.processCapture(e2,h2.client,'alice'),/CAPTURE_ACCOUNT_CHANGED/);assert.equal(h2.remote.size,0);
});
test('reminder failure never reports record save failure and is visible separately',async()=>{
 const h=harness();h.failReminder();const saved=await h.api.processCapture(await h.receive(),h.client,'alice');
 assert.ok(saved.saved.pageId);assert.match(saved.reminderWarning,/알림/);assert.equal(h.remote.size,1);
});
