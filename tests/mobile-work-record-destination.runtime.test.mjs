import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {nativeComponentHarness} from './helpers/native-component-harness.mjs';
register('./helpers/mobile-ts-loader.mjs',import.meta.url);
const api=await import('../mobile/src/features/work/work-record-destination.ts');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function editor(overrides={}) {
 let moves=0,normal=0;const cleanup=[],messages=[],destinations=[],scheduled=[],alarms=[],scheduleRequests=[];
 const imports={
  './work-record-edit-sheet':{WorkRecordEditSheet:'Sheet'},
  './work-folders-store':{loadFolders:async()=>[{id:'salt',name:'소금'}]},
  './work-record-destination':{
   readDestination:async()=>({updatedAt:'2026-11-18T01:00:00Z',folderId:'salt',version:0}),
   moveWorkDestination:async()=>{moves++;return ['schedule-1','schedule-2'];},
   scheduleWorkRecord:async (_client,owner,id,title,date,time,snapshot)=>{
    scheduleRequests.push({owner,id,title,date,time,snapshot});
    return {id:'schedule',title,startsAt:`${date}T${time}:00+09:00`,status:'confirmed',allDay:false};
   },
  },
  '@/src/features/schedule/schedule-reminder-snapshot':{reminderSessionEpoch:{capture:()=>()=>true}},
  '@/src/features/schedule/schedule-reminder-post-save':{cancelSavedScheduleReminders:async ids=>cleanup.push(ids),synchronizeUpdatedScheduleReminder:async row=>{alarms.push(row.id);return {action:'scheduled'};}},
  '@/src/features/schedule/reminder-feedback':{reminderFailureMessage:()=> '알림 예약 미확인'},
  ...overrides,
 };
 const h=nativeComponentHarness('mobile/src/features/work/work-record-folder-editor.tsx','WorkRecordFolderEditor',imports);
 const props={client:{},recordId:'r',ownerId:'owner',visible:true,title:'소금 견적',date:'2099-11-17',time:'15:00',actionKind:'note',loading:false,saving:false,ready:true,onSave:()=>normal++,onMoved:(m,d)=>{messages.push(m);destinations.push(d);},onScheduled:(schedule,message)=>scheduled.push({schedule,message})};
 const render=()=>h.render(props).props;
 return {...h,props,render,messages,destinations,cleanup,scheduled,alarms,scheduleRequests,get moves(){return moves},get normal(){return normal},async load(){render();await h.effects();return render();}};
}
test('ordinary save delegates; explicit kind and folder save once, cancel every linked device alarm then report',async()=>{
 const h=editor();try{
  let p=await h.load();p.onSave();assert.equal(h.normal,1);
  p.folderDestination.onChange('task');p=h.render();assert.equal(p.folderDestination.value.folderId,'salt');
  p.folderDestination.onFolder(null);p=h.render();p.folderDestination.onChange('note');p=h.render();assert.equal(p.folderDestination.value.folderId,null,'explicit unclassified survives kind switching');
  p.onSave();p.onSave();await tick();assert.equal(h.moves,1);assert.deepEqual(h.cleanup,[['schedule-1','schedule-2']]);assert.equal(h.messages.length,1);assert.match(h.messages[0],/구글/);assert.deepEqual(h.destinations,[{kind:'note',folderId:null}]);assert.equal(h.render().ready,false);
 }finally{h.close()}
});
test('failed save keeps destination and title; no cleanup or success; failed alarm cleanup does not repeat committed write',async()=>{
 let writes=0;const h=editor({'./work-record-destination':{readDestination:async()=>({updatedAt:'time',folderId:null,version:-1}),moveWorkDestination:async()=>{writes++;throw Error('conflict')}}});
 try{let p=await h.load();p.folderDestination.onChange('task');p=h.render();p.onSave();await tick();p=h.render();assert.equal(p.title,'소금 견적');assert.equal(p.folderDestination.value.kind,'task');assert.match(p.statusText,/conflict/);assert.equal(h.messages.length,0);assert.equal(h.cleanup.length,0);}finally{h.close()}
 const h2=editor({'@/src/features/schedule/schedule-reminder-post-save':{cancelSavedScheduleReminders:async()=>{throw Error('device offline')}}});
 try{let p=await h2.load();p.folderDestination.onChange('task');h2.render().onSave();await tick();assert.equal(h2.moves,1);assert.match(h2.messages[0],/알림 정리는 확인/);h2.render().onSave();await tick();assert.equal(h2.moves,1);}finally{h2.close()}
});
test('account/unmount guard blocks late UI success and alarm cleanup',async()=>{
 let resolve;const h=editor({'./work-record-destination':{readDestination:async()=>({updatedAt:'time',folderId:null,version:-1}),moveWorkDestination:()=>new Promise(r=>resolve=r)}});
 let p=await h.load();p.folderDestination.onChange('task');h.render().onSave();h.close();resolve(['schedule']);await tick();assert.equal(h.messages.length,0);assert.equal(h.cleanup.length,0);
});
test('RPC adapter sends owner and optimistic versions, rejects missing server and malformed confirmation without fallback writes',async()=>{
 const calls=[];const client={rpc:(name,args)=>({abortSignal:async()=>{calls.push({name,args});return {data:{recordId:'r',cancelledScheduleIds:['s']},error:null}}})};
 assert.deepEqual(await api.moveWorkDestination(client,'owner','r','  title ',{kind:'task',folderId:'f'},{updatedAt:'time',folderId:null,version:-1}),['s']);
 assert.deepEqual(calls[0].args,{p_owner:'owner',p_id:'r',p_title:'title',p_kind:'task',p_folder:'f',p_updated_at:'time',p_version:-1});
 await assert.rejects(api.readDestination({rpc:()=>({abortSignal:async()=>({error:{code:'PGRST202'}})})},'r'),/서버 반영/);
 await assert.rejects(api.moveWorkDestination({rpc:()=>({abortSignal:async()=>({data:{recordId:'wrong',cancelledScheduleIds:[]},error:null})})},'owner','r','title',{kind:'task',folderId:null},{updatedAt:'time',version:-1}),/목록을 확인/);
});

test('one save of a memo uses the existing date and time, then reports the confirmed home schedule',async()=>{
 const h=editor();
 try {
  const p=await h.load();
  assert.equal(p.folderDestination.canSchedule,true);
  p.folderDestination.onChange('schedule');
  const sheet=h.render();
  sheet.onSave();
  sheet.onSave();
  await tick();
  assert.equal(h.normal,0);
  assert.equal(h.moves,0);
  assert.equal(h.scheduleRequests.length,1);
  assert.deepEqual(h.scheduleRequests[0],{owner:'owner',id:'r',title:'소금 견적',date:'2099-11-17',time:'15:00',
    snapshot:{updatedAt:'2026-11-18T01:00:00Z',folderId:'salt',version:0}});
  assert.deepEqual(h.alarms,['schedule']);
  assert.match(h.scheduled[0].message,/홈 일정에 저장했습니다/);
  assert.equal(h.scheduled[0].schedule.startsAt,'2099-11-17T15:00:00+09:00');
 } finally { h.close(); }
});

test('schedule conversion validates date and verifies title and instant in the server receipt',async()=>{
 const calls=[];
 const schedule={id:'s',title:'title',startsAt:'2026-11-26T06:00:00Z',status:'confirmed',allDay:false};
 const client={rpc:(name,args)=>({abortSignal:async()=>{
  calls.push({name,args});
  return {data:{recordId:'r',schedule},error:null};
 }})};
 const snapshot={updatedAt:'version',folderId:null,version:-1};
 await assert.rejects(api.scheduleWorkRecord(client,'owner','r','title','2026-02-30','15:00',snapshot),/시작 시간/);
 assert.equal(calls.length,0);
 assert.deepEqual(await api.scheduleWorkRecord(client,'owner','r',' title ','2026-11-26','15:00',snapshot),schedule);
 assert.deepEqual(calls[0],{name:'schedule_my_work_record',args:{p_owner:'owner',p_id:'r',p_title:'title',p_starts_at:'2026-11-26T15:00:00+09:00',p_updated_at:'version'}});
 await assert.rejects(api.scheduleWorkRecord(client,'owner','r','title','2026-11-26','14:00',snapshot),/홈 캘린더를 확인/);
});
