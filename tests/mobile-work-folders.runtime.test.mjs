import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { nativeComponentHarness, nativeNodes, nativeWords } from './helpers/native-component-harness.mjs';
register('./helpers/mobile-ts-loader.mjs',import.meta.url);
const store=await import('../mobile/src/features/work/work-folders-store.ts');
const theme=await import('../mobile/src/ui/theme.ts');
const date=await import('../mobile/src/features/home/home-calendar-model.ts');
const folder={id:'f',name:'Personal project',parent_id:null,version:0};
const record={id:'r',title:'Undated task',content:'Same source',original_text:'',status:'in_progress',action_kind:'task',due_at:null,completed_at:null,folder_id:null,selected_on:null,organization_version:-1};
const tick=()=>new Promise(r=>setImmediate(r));
function harness(overrides={},home=false){
 const boundaries={...store,loadFolders:async()=>[folder],loadFolderRecords:async()=>[record],saveFolder:async()=>{},organizeRecord:async()=>{},...overrides};
 const h=nativeComponentHarness('mobile/src/features/work/work-folders.tsx','WorkFolders',{
  'expo-crypto':{randomUUID:()=> 'new-folder'},'@/src/ui/theme':theme,'../home/home-calendar-model':date,'./work-folders-store':boundaries,
  '@/src/platform/worklog-api':{loadWorkJournalDay:async()=>({completed:[{pageId:'done',title:'Journal completion'}]})},
  '@/src/platform/authenticated-access':{getFreshAccessToken:async()=> 'synthetic'},
 });
 const props={client:{},userId:'owner',home,revision:0,busy:false,onComplete:async()=>{},onInput:()=>{}};
 const render=()=>h.render(props);
 const button=label=>nativeNodes(render()).find(n=>n.props?.accessibilityLabel===label);
 const flush=async()=>{render();await h.effects();render();await h.effects();};
 return {...h,props,render,button,flush};
}
test('folder path and move picker reject self, descendant, missing target and cycles',()=>{
 const folders=[folder,{id:'child',name:'Nested',parent_id:'f',version:0},{id:'deep',name:'Deep',parent_id:'child',version:0}];
 assert.equal(store.folderPath(folders,'deep'),'Personal project / Nested / Deep');
 assert.equal(store.canMoveFolder(folders,'f','deep'),false);
 assert.equal(store.canMoveFolder(folders,'f','f'),false);
 assert.equal(store.canMoveFolder(folders,'f','missing'),false);
 assert.equal(store.canMoveFolder(folders,'child',null),true);
});
test('real RPC adapter sends only organization intent and version, never due_at or Schedule; reports unavailable DB',async()=>{
 const calls=[];
 const client={rpc:(name,args)=>({abortSignal:async()=>{calls.push({name,args});return{data:[],error:null};}})};
 await store.organizeRecord(client,record,{today:true},'owner');await store.organizeRecord(client,record,{folder:'f'},'owner');
 assert.deepEqual(calls.map(c=>c.args),[{p_owner:'owner',p_id:'r',p_version:-1,p_command:{today:true}},{p_owner:'owner',p_id:'r',p_version:-1,p_command:{folder:'f'}}]);
 assert.ok(calls.every(c=>c.name==='organize_my_work_record'));
 await assert.rejects(store.loadFolders({rpc:()=>({abortSignal:async()=>({error:{code:'PGRST202'}})})}),/서버 준비 중/);
 await assert.rejects(store.loadFolders({rpc:()=>({abortSignal:async()=>({data:null,error:null})})}),/응답/);
 await assert.rejects(store.organizeRecord({rpc:()=>({abortSignal:async()=>({error:{code:'PT409'}})})},record,{today:true},'owner'),/다른 화면에서 변경/);
});
test('actual folder screen: unclassified task, nested folder create/rename/move, no seeded example folders',async()=>{
 let created,inputs=0;const h=harness({saveFolder:async(_client,row)=>{created=row;}});
 h.props.onInput=()=>inputs++;
 try{
  await h.flush();assert.match(nativeWords(h.render()),/미분류.*Undated task/s);
  h.button('업무·메모 등록').props.onPress();assert.equal(inputs,1);
  h.button('Personal project 폴더 열기').props.onPress();await h.flush();
  h.button('하위 폴더 만들기').props.onPress();
  nativeNodes(h.render()).find(n=>n.type==='TextInput').props.onChangeText('Child');
  h.button('폴더 저장').props.onPress();await tick();await h.flush();
  assert.deepEqual(created,{id:'new-folder',name:'Child',parent_id:'f',version:-1});
  h.button('폴더 이름 변경').props.onPress();nativeNodes(h.render()).find(n=>n.type==='TextInput').props.onChangeText('Renamed');
  h.button('폴더 저장').props.onPress();await tick();await h.flush();assert.equal(created.name,'Renamed');assert.equal(created.version,0);
  h.button('폴더 이동').props.onPress();assert.ok(h.button('최상위로 이동'));assert.equal(h.button('Personal project'),undefined);
 } finally{h.close();}
});
test('today selection sends one mutation under rapid presses; confirmed reload; completion uses existing callback',async()=>{
 let resolve,calls=0,completed=0,selected=false;
 const pending=new Promise(r=>resolve=r);
 const h=harness({loadFolderRecords:async()=>[{...record,selected_on:selected?'2026-01-01':null}],organizeRecord:async(_client,_row,command)=>{calls++;assert.deepEqual(command,{today:true});await pending;selected=true;}});
 h.props.onComplete=async task=>{completed++;assert.equal(task.pageId,'r');};
 try{
  await h.flush();for(let i=0;i<10;i++)h.button('오늘 하기').props.onPress();assert.equal(calls,1);
  assert.match(nativeWords(h.render()),/저장 확인 중/);resolve();await tick();await h.flush();assert.ok(h.button('오늘 선택 해제'));
  h.button('Undated task 완료').props.onPress();await tick();assert.equal(completed,1);
 } finally{h.close();}
});
test('work move supports unclassified and existing folders; failed save retains editor text',async()=>{
 let command;const h=harness({organizeRecord:async(_client,_row,c)=>{command=c;},saveFolder:async()=>{throw Error('저장 확인 필요');}});
 try{
  await h.flush();h.button('Undated task 폴더 이동').props.onPress();h.button('Personal project').props.onPress();await tick();await h.flush();assert.deepEqual(command,{folder:'f'});
  h.button('Undated task 폴더 이동').props.onPress();h.button('미분류로 이동').props.onPress();await tick();await h.flush();assert.deepEqual(command,{folder:null});
  h.button('폴더 만들기').props.onPress();nativeNodes(h.render()).find(n=>n.type==='TextInput').props.onChangeText('Keep draft');
  h.button('폴더 저장').props.onPress();await tick();assert.match(nativeWords(h.render()),/저장 확인 필요/);assert.equal(nativeNodes(h.render()).find(n=>n.type==='TextInput').props.value,'Keep draft');
 } finally{h.close();}
});
test('unapplied database shows honest fallback, registration remains available, home done reuses journal',async()=>{
 let input=0;const h=harness({loadFolders:async()=>{throw Error('개인 폴더 기능은 서버 준비 중입니다.');}});h.props.onInput=()=>input++;
 try{await h.flush();assert.match(nativeWords(h.render()),/서버 준비 중/);assert.equal(h.button('폴더 만들기').props.disabled,true);assert.equal(h.button('업무·메모 등록').props.disabled,false);h.button('업무·메모 등록').props.onPress();assert.equal(input,1);}finally{h.close();}
 const home=harness({},true);try{await home.flush();assert.match(nativeWords(home.render()),/다음 날에도/);assert.match(nativeWords(home.render()),/Journal completion/);}finally{home.close();}
});
test('late folder response after navigation cannot replace the current folder',async()=>{
 let oldResolve;const h=harness({loadFolderRecords:async(_client,folder)=>folder==='f'?[{...record,title:'Folder task'}]:new Promise(r=>oldResolve=r)});
 try{
  h.render();await h.effects();
  // Finish initial read to expose folder controls, then begin a refresh.
  oldResolve([record]);await tick();h.render();h.button('새로고침').props.onPress();h.render();await h.effects();const stale=oldResolve;
  // Simulate navigation while the old read is in flight (native handler boundary).
  h.button('Personal project 폴더 열기').props.onPress();await h.flush();stale([{...record,title:'Stale task'}]);await tick();
  assert.match(nativeWords(h.render()),/Folder task/);assert.doesNotMatch(nativeWords(h.render()),/Stale task/);
 } finally{h.close();}
});
