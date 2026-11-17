import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {nativeComponentHarness} from './helpers/native-component-harness.mjs';
register('./helpers/mobile-ts-loader.mjs',import.meta.url);
const api=await import('../mobile/src/features/work/work-record-destination.ts');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function editor(overrides={}) {
 let moves=0,normal=0;const cleanup=[],messages=[];
 const imports={
  './work-record-edit-sheet':{WorkRecordEditSheet:'Sheet'},
  './work-folders-store':{loadFolders:async()=>[{id:'salt',name:'소금'}]},
  './work-record-destination':{readDestination:async()=>({updatedAt:'2026-11-18T01:00:00Z',folderId:'salt',version:0}),moveWorkDestination:async()=>{moves++;return ['schedule-1','schedule-2'];}},
  '@/src/features/schedule/schedule-reminder-snapshot':{reminderSessionEpoch:{capture:()=>()=>true}},
  '@/src/features/schedule/schedule-reminder-post-save':{cancelSavedScheduleReminders:async ids=>cleanup.push(ids)},
  ...overrides,
 };
 const h=nativeComponentHarness('mobile/src/features/work/work-record-folder-editor.tsx','WorkRecordFolderEditor',imports);
 const props={client:{},recordId:'r',ownerId:'owner',visible:true,title:'소금 견적',date:'2026-11-17',time:'15:00',loading:false,saving:false,ready:true,onSave:()=>normal++,onMoved:m=>messages.push(m)};
 const render=()=>h.render(props).props;
 return {...h,props,render,messages,cleanup,get moves(){return moves},get normal(){return normal},async load(){render();await h.effects();return render();}};
}
test('ordinary save delegates; explicit kind and folder save once, cancel every linked device alarm then report',async()=>{
 const h=editor();try{
  let p=await h.load();p.onSave();assert.equal(h.normal,1);
  p.folderDestination.onChange('task');p=h.render();assert.equal(p.folderDestination.value.folderId,'salt');
  p.folderDestination.onFolder(null);p=h.render();p.folderDestination.onChange('note');p=h.render();assert.equal(p.folderDestination.value.folderId,null,'explicit unclassified survives kind switching');
  p.onSave();p.onSave();await tick();assert.equal(h.moves,1);assert.deepEqual(h.cleanup,[['schedule-1','schedule-2']]);assert.equal(h.messages.length,1);assert.match(h.messages[0],/구글/);assert.equal(h.render().ready,false);
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
