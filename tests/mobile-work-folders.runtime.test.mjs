import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { nativeComponentHarness, nativeNodes, nativeWords } from './helpers/native-component-harness.mjs';
register('./helpers/mobile-ts-loader.mjs',import.meta.url);
const store=await import('../mobile/src/features/work/work-folders-store.ts');
const shared=await import('../mobile/src/ui/workspace-styles.ts');
const rows=await import('../mobile/src/ui/record-row-styles.ts');
const theme=await import('../mobile/src/ui/theme.ts');
const date=await import('../mobile/src/features/home/home-calendar-model.ts');
const folder={id:'f',name:'Personal project',parent_id:null,version:0,task_count:3};
const record={id:'r',title:'Undated task',content:'Same source',original_text:'',status:'in_progress',action_kind:'task',due_at:null,completed_at:null,folder_id:null,selected_on:null,organization_version:-1};
const view=(records=[record],extra={})=>({folders:[folder],records,all_tasks:4,unclassified_tasks:1,total_count:records.length,...extra});
const tick=()=>new Promise(r=>setImmediate(r));
function harness(overrides={}){
 const boundaries={...store,loadWorkOverview:async()=>view(),saveFolder:async()=>{},organizeRecord:async()=>{},...overrides};
 const complete=nativeComponentHarness('mobile/src/ui/record-complete-button.tsx','RecordCompleteButton',{'./record-row-styles':rows});
 const h=nativeComponentHarness('mobile/src/features/work/work-folders.tsx','WorkFolders',{
  '@/src/ui/workspace-styles':shared,'@/src/ui/record-row-styles':rows,
  '@/src/ui/record-complete-button':{RecordCompleteButton:props=>complete.render(props)},
  'expo-crypto':{randomUUID:()=> 'new-folder'},'@/src/ui/theme':theme,'../home/home-calendar-model':date,'./work-folders-store':boundaries,'./work-documents':{WorkDocuments:()=>null},
 });
 const props={client:{},userId:'owner',revision:0,busy:false,onComplete:async()=>{},onCompleteNote:async()=>{},onJournal:()=>{},onSearch:()=>{},onEdit:()=>{},onDelete:()=>{},onReminder:()=>{}};
 const expand=node=>Array.isArray(node)?node.map(expand):node&&typeof node==='object'?typeof node.type==='function'?expand(node.type(node.props)):{...node,props:{...node.props,children:expand(node.props.children)}}:node;
 const render=()=>expand(h.render(props));
 const button=label=>nativeNodes(render()).find(n=>n.props?.accessibilityLabel===label);
 const tab=label=>nativeNodes(render()).find(n=>n.props?.accessibilityRole==='tab'&&nativeWords(n)===label);
 const flush=async()=>{render();await h.effects();render();await h.effects();};
 return {...h,props,render,button,tab,flush};
}
test('folder path and move picker reject self, descendant, missing target and cycles',()=>{
 const folders=[folder,{id:'child',name:'Nested',parent_id:'f',version:0},{id:'deep',name:'Deep',parent_id:'child',version:0}];
 assert.equal(store.folderPath(folders,'deep'),'Personal project / Nested / Deep');
 assert.equal(store.canMoveFolder(folders,'f','deep'),false);assert.equal(store.canMoveFolder(folders,'f','f'),false);
 assert.equal(store.canMoveFolder(folders,'f','missing'),false);assert.equal(store.canMoveFolder(folders,'child',null),true);
});
test('overview adapter distinguishes all and unclassified and keeps server count beyond page size',async()=>{
 const calls=[];const client={rpc:(name,args)=>({abortSignal:async()=>{calls.push({name,args});return{data:view([record],{total_count:71,all_tasks:71}),error:null};}})};
 assert.equal((await store.loadWorkOverview(client,'all','tasks')).all_tasks,71);
 await store.loadWorkOverview(client,null,'notes',50);
 assert.deepEqual(calls,[{name:'get_my_work_overview',args:{p_all:true,p_folder:null,p_section:'tasks',p_offset:0}},{name:'get_my_work_overview',args:{p_all:false,p_folder:null,p_section:'notes',p_offset:50}}]);
 await assert.rejects(store.loadWorkOverview({rpc:()=>({abortSignal:async()=>({error:{code:'PGRST202'}})})},'all','tasks'),/서버 준비 중/);
 await assert.rejects(store.loadWorkOverview({rpc:()=>({abortSignal:async()=>({data:null,error:null})})},'all','tasks'),/응답/);
});
test('default all, explicit unclassified and folder counts; filters directly precede rows; no duplicate input/today controls',async()=>{
 const calls=[];const h=harness({loadWorkOverview:async(_client,scope,section)=>{calls.push({scope,section});return view();}});
 try{
  await h.flush();assert.deepEqual(calls,[{scope:'all',section:'tasks'}]);
  assert.equal(h.button('전체 4개 할 일').props.accessibilityState.selected,true);
  assert.ok(h.button('Personal project 3개 할 일'));assert.ok(h.button('미분류 1개 할 일'));
  assert.doesNotMatch(nativeWords(h.render()),/오늘 하기|오늘 끝낸 일|직접 입력|날짜 없음|날짜별 업무일지|과거 기록 검색/);
  h.button('미분류 1개 할 일').props.onPress();await h.flush();assert.equal(calls.at(-1).scope,null);
  h.button('Personal project 3개 할 일').props.onPress();await h.flush();assert.equal(calls.at(-1).scope,'f');
  h.tab('메모·자료').props.onPress();await h.flush();assert.equal(calls.at(-1).section,'notes');
 }finally{h.close();}
});
test('create/rename/move use modal, retain draft after failure and block double saves',async()=>{
 let created,calls=0,rejectSave;const h=harness({saveFolder:async(_c,row)=>{created=row;calls++;if(calls===1)await new Promise((_resolve,reject)=>rejectSave=reject);}});
 try{
  await h.flush();h.button('폴더 만들기').props.onPress();
  const dialog=()=>nativeNodes(h.render()).find(n=>n.type==='Modal');
  const field=()=>nativeNodes(dialog()).find(n=>n.type==='TextInput');
  assert.equal(nativeNodes(dialog()).find(n=>n.type==='KeyboardAvoidingView').props.behavior,undefined);
  let focused=0;field().props.ref.current={focus(){focused++;}};dialog().props.onShow();assert.equal(focused,1);
  field().props.onSubmitEditing();assert.equal(calls,0);
  field().props.onChangeText('Keep folder');field().props.onSubmitEditing();field().props.onSubmitEditing();assert.equal(calls,1);
  dialog().props.onRequestClose();assert.ok(dialog());rejectSave(Error('저장 확인 필요'));await tick();
  assert.equal(field().props.value,'Keep folder');assert.match(nativeWords(dialog()),/저장 확인 필요/);
  h.button('폴더 저장').props.onPress();await tick();await h.flush();assert.equal(dialog(),undefined);assert.equal(created.parent_id,null);
  h.button('Personal project 3개 할 일').props.onPress();await h.flush();h.button('하위 폴더 만들기').props.onPress();field().props.onChangeText('Child');h.button('폴더 저장').props.onPress();await tick();await h.flush();assert.equal(created.parent_id,'f');
  h.button('업무 메뉴').props.onPress();h.button('폴더 이름 변경').props.onPress();field().props.onChangeText('Renamed');h.button('폴더 저장').props.onPress();await tick();await h.flush();assert.equal(created.version,0);
  h.button('업무 메뉴').props.onPress();h.button('폴더 이동').props.onPress();assert.ok(dialog());assert.ok(h.button('최상위로 이동'));assert.equal(h.button('Personal project'),undefined);
 }finally{h.close();}
});
test('completion is one canonical call, counts and list refresh; note completion stays in history',async()=>{
 let done=false,calls=0,resolve;const pending=new Promise(r=>resolve=r);
 const h=harness({loadWorkOverview:async(_c,_f,section)=>view(section==='completed'?(done?[{...record,action_kind:'note',briefing_state:'acknowledged',acknowledged_at:'2026-11-17T16:00:00Z'}]:[]):done?[]:[{...record,action_kind:'note',briefing_state:'active'}],{all_tasks:done?0:1})});
 h.props.onCompleteNote=async note=>{calls++;assert.equal(note.pageId,'r');await pending;done=true;};
 try{
  await h.flush();const press=h.button('Undated task 완료').props.onPress;press();press();assert.equal(calls,1);
  resolve();await tick();await h.flush();assert.doesNotMatch(nativeWords(h.render()),/Undated task/);assert.ok(h.button('전체 0개 할 일'));
  h.tab('완료').props.onPress();await h.flush();assert.match(nativeWords(h.render()),/완료\s+2026-11-18/);assert.equal(h.button('Undated task 완료'),undefined);assert.ok(h.button('날짜별 업무일지'));
 }finally{h.close();}
});
test('task completion/edit and contextual move/reminder/delete keep existing callbacks',async()=>{
 let command,completed,edited,deleted,reminded;const h=harness({organizeRecord:async(_c,_r,c)=>command=c});
 h.props.onComplete=async row=>completed=row;h.props.onEdit=r=>edited=r;h.props.onDelete=r=>deleted=r;h.props.onReminder=r=>reminded=r;
 try{
  await h.flush();h.button('Undated task 수정').props.onPress();assert.equal(edited.id,'r');
  h.button('Undated task 더 보기').props.onPress();h.button('폴더 이동').props.onPress();assert.ok(nativeNodes(h.render()).some(n=>n.type==='Modal'));h.button('Personal project').props.onPress();await tick();await h.flush();assert.deepEqual(command,{folder:'f'});
  h.button('Undated task 더 보기').props.onPress();h.button('알림 설정').props.onPress();assert.equal(reminded.id,'r');
  h.button('Undated task 더 보기').props.onPress();h.button('삭제').props.onPress();assert.equal(deleted.id,'r');
  h.button('Undated task 완료').props.onPress();await tick();assert.equal(completed.pageId,'r');
 }finally{h.close();}
});
test('same-scope refresh keeps counts/rows on pending and failed read; different scope hides stale rows',async()=>{
 let resolve,reject,calls=0;const h=harness({loadWorkOverview:async(_c,scope)=>{calls++;if(calls===1)return view();if(scope==='f')return view([{...record,title:'Folder task'}]);return new Promise((a,b)=>{resolve=a;reject=b;});}});
 try{
  await h.flush();h.button('새로고침').props.onPress();h.render();await h.effects();assert.match(nativeWords(h.render()),/Undated task/);assert.ok(h.button('전체 4개 할 일'));
  reject(Error('연결 실패'));await tick();assert.match(nativeWords(h.render()),/Undated task.*연결 실패|연결 실패.*Undated task/s);
  h.button('새로고침').props.onPress();h.render();await h.effects();const stale=resolve;
  h.button('Personal project 3개 할 일').props.onPress();assert.doesNotMatch(nativeWords(h.render()),/Undated task/);await h.flush();stale(view([{...record,title:'Stale task'}]));await tick();
  assert.match(nativeWords(h.render()),/Folder task/);assert.doesNotMatch(nativeWords(h.render()),/Stale task/);
 }finally{h.close();}
});
test('late response after account unmount cannot update screen',async()=>{
 let resolve;const h=harness({loadWorkOverview:()=>new Promise(r=>resolve=r)});
 h.render();await h.effects();h.close();resolve(view());await tick();assert.equal(h.states[2],null);
});
test('converted record starts in chosen folder and notes; explicit null remains unclassified',async()=>{
 for(const scope of ['f',null]){
  const calls=[];const h=harness({loadWorkOverview:async(_c,folder,section)=>{calls.push({folder,section});return view();}});
  h.props.initialFolder=scope;h.props.initialSection='notes';
  try{await h.flush();assert.deepEqual(calls,[{folder:scope,section:'notes'}]);}finally{h.close();}
 }
});
test('workspace menu preserves search/journal without permanent buttons between tabs and list',async()=>{
 let journal=0,search=0;const h=harness();h.props.onJournal=()=>journal++;h.props.onSearch=()=>search++;
 try{await h.flush();assert.equal(h.button('과거 기록 검색'),undefined);h.button('업무 메뉴').props.onPress();h.button('과거 기록 검색').props.onPress();assert.equal(search,1);h.button('업무 메뉴').props.onPress();h.button('날짜별 업무일지').props.onPress();assert.equal(journal,1);}finally{h.close();}
});

test('view changes are reported for return navigation; conversion updates an already mounted Work tab',async()=>{
 const views=[];const h=harness();h.props.onViewChange=(scope,section)=>views.push({scope,section});
 try{
  await h.flush();h.button('Personal project 3개 할 일').props.onPress();await h.flush();h.tab('완료').props.onPress();await h.flush();
  assert.deepEqual(views.at(-1),{scope:'f',section:'completed'});
  h.props.initialFolder=null;h.props.initialSection='notes';await h.flush();
  assert.equal(h.button('미분류 1개 할 일').props.accessibilityState.selected,true);assert.equal(h.tab('메모·자료').props.accessibilityState.selected,true);
 }finally{h.close();}
});
