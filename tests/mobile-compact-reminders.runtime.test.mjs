import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, register } from 'node:module';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { findWorklogReminderLinks } = await import('../mobile/src/features/schedule/worklog-reminder-adapter.ts');
const { reminderLabel, reminderPresentation } = await import('../mobile/src/features/home/reminder-label.ts');
const ts = createRequire(new URL('../mobile/package.json', import.meta.url))('typescript');
const owner = '11111111-1111-4111-8111-111111111111';
const rid = '22222222-2222-4222-8222-222222222222';
const sid = '33333333-3333-4333-8333-333333333333';
function compile(path, scope) {
 const source = readFileSync(path,'utf8');
 const js = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
 const exports = {};
 new Function('require','exports','React',js)(name => scope[name] || {}, exports, scope.React);
 return exports;
}
test('stable linkage batches 101 records in three reads, rejects truncated and cross-account results', async () => {
 const ids = Array.from({length:101},(_,i)=>`22222222-2222-4222-8222-${String(i).padStart(12,'0')}`);
 let queries=0, auth=0, truncated=false, changed=false;
 const c = {auth:{async getUser(){auth++; return {data:{user:{id:changed && auth%2===0 ? sid : owner}}};}}, from(table){
  assert.equal(table,'schedules'); return {select(fields,options){assert.equal(options.count,'exact'); return {eq(key,value){assert.equal(key,'created_by_user_id');assert.equal(value,owner);return {async or(filter){queries++; assert.ok(!filter.includes('title'));return {data:[],count:truncated?1:0};}};}};}};}};
 assert.deepEqual(await findWorklogReminderLinks(c,ids,()=>true),{}); assert.equal(queries,3);assert.equal(auth,2);
 truncated=true;await assert.rejects(findWorklogReminderLinks(c,[rid],()=>true),/INCOMPLETE/);
 truncated=false;auth=0;changed=true;await assert.rejects(findWorklogReminderLinks(c,[rid],()=>true),/OWNER_CHANGED/);
 await assert.rejects(findWorklogReminderLinks(c,[rid],()=>false),/STALE/);
});
test('both linkage keys resolve by identity; ambiguous links are preserved for safe unknown presentation',async()=>{
 const rows=[{id:sid,created_by_user_id:owner,metadata:{workRecordId:rid,reminderWorkRecordId:rid}},{id:owner,created_by_user_id:owner,metadata:{workRecordId:rid}}];
 const c={auth:{async getUser(){return {data:{user:{id:owner}}};}},from(){return{select(){return{eq(){return{async or(){return{data:rows,count:2};}};}};}};}};
 assert.deepEqual((await findWorklogReminderLinks(c,[rid],()=>true))[rid],[sid,owner]);
});
test('compact schedule and task buttons share words, wrapping and >=44 point target',()=>{
 let label='알림 확인 필요';let calls=0;
 const React={createElement:(type,props,...children)=>({type,props,children})};
 const {CompactReminderLabel,ScheduleReminderLabel}=compile('mobile/src/features/home/schedule-reminder-label.tsx',{
  React,'react-native':{Pressable:'Pressable',Text:'Text'},'./reminder-label':{reminderPresentation},'./home-reminder-status':{useReminderStatus:()=>label},
 });
 for(const current of ['알림 확인 필요','이 기기 알림 없음 · 설정','알림 권한 차단 · 설정','이 기기 예약: 시작 시 · 30분 전','일정 취소됨 · 알림 확인 필요']){
  label=current;
  const record=CompactReminderLabel({id:rid,record:true,title:'Synthetic',onPress:()=>calls++});
  const upper=ScheduleReminderLabel({schedule:{scheduleId:sid,title:'Synthetic'},onPress:()=>calls++});
  const schedule=upper.type(upper.props);
  assert.deepEqual(record.children,schedule.children);
  assert.equal(record.props.style.minHeight,44);assert.equal(record.props.style.maxWidth,'100%');
  assert.equal(record.children[0].props.numberOfLines,undefined);
  assert.ok(record.props.accessibilityLabel.includes(current));record.props.onPress();
 }
 assert.equal(calls,5);
});
test('past stored or native-only evidence never claims delivered or confirmed absent',()=>{
 const e={permission:'granted',stored:[{identifier:'n',offsetMinutes:0,triggerAt:'2020-01-01T00:00:00Z',title:'Synthetic'}],scheduled:[]};
 assert.equal(reminderLabel(sid,e),'알림 설정 기록 있음 · 예약 확인 필요');
 assert.equal(reminderLabel(sid,{...e,stored:[],scheduled:[{identifier:'n',content:{data:{target:'schedule',scheduleId:sid}}}]}),'알림 확인 필요');
});

test('home snapshot shares one device read and drops late responses after account/route cleanup',async()=>{
 let state=null,effect,cleanup,resolveNative,nativeReads=0;
 const React={createElement:(type,props,...children)=>({type,props,children})};
 const {HomeReminderStatus}=compile('mobile/src/features/home/home-reminder-status.tsx',{
  React,react:{createContext:()=>({Provider:'Provider'}),useState:()=>[state,value=>{state=value;}],useEffect:fn=>{effect=fn;}},
  '../schedule/worklog-reminder-adapter':{findWorklogReminderLinks:async()=>({[rid]:[sid]})},
  '../schedule/schedule-reminder-snapshot':{reminderSessionEpoch:{capture:()=>()=>true},reminderSyncEpoch:{capture:()=>()=>true},readOwnedReminderSnapshots:async()=>({rows:[{id:sid,title:'Synthetic',status:'confirmed',startsAt:'2099-01-01T00:00:00Z',allDay:false}]})},
  '../schedule/local-notifications':{readScheduleReminderEvidenceBatch:async ids=>{nativeReads++;assert.deepEqual(ids,[sid]);return new Promise(resolve=>{resolveNative=resolve;});}},
  './reminder-label':{reminderLabel},
 });
 const briefing={structure:{today:[{pageId:rid}]},schedules:{today:[{scheduleId:sid,title:'Synthetic',startsAt:'2099-01-01T00:00:00Z'}]}};
 const props={client:{},briefing,scope:'account-a:home:1',children:null};
 HomeReminderStatus(props);cleanup=effect();await new Promise(resolve=>setImmediate(resolve));
 resolveNative({[sid]:{permission:'granted',stored:[],scheduled:[]}});await new Promise(resolve=>setImmediate(resolve));
 let tree=HomeReminderStatus(props);
 assert.equal(tree.props.value[`record:${rid}`],'이 기기 알림 없음 · 설정');
 assert.equal(tree.props.value[`record:${rid}`],tree.props.value[`schedule:${sid}`]);assert.equal(nativeReads,1);
 cleanup();tree=HomeReminderStatus({...props,scope:'account-b:journal:2'});assert.deepEqual(tree.props.value,{});
 cleanup=effect();await new Promise(resolve=>setImmediate(resolve));cleanup();state=null;
 resolveNative({[sid]:{permission:'granted',stored:[],scheduled:[]}});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(state,null);
});

test('installed Supabase query keeps exact count, creator scope and both stable JSON linkage keys',async()=>{
 const {createClient}=createRequire(new URL('../mobile/package.json',import.meta.url))('@supabase/supabase-js');
 let reads=0;
 const client=createClient('https://example.supabase.co','synthetic-public-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(url,init)=>{
  reads++;const query=new URL(url);
  assert.equal(query.searchParams.get('created_by_user_id'),`eq.${owner}`);
  assert.equal(query.searchParams.get('or'),`(metadata->>workRecordId.in.(${rid}),metadata->>reminderWorkRecordId.in.(${rid}))`);
  assert.match(new Headers(init.headers).get('prefer'),/count=exact/);
  return new Response(JSON.stringify([{id:sid,created_by_user_id:owner,metadata:{workRecordId:rid}}]),{status:200,headers:{'content-type':'application/json','content-range':'0-0/1'}});
 }}});
 client.auth.getUser=async()=>({data:{user:{id:owner}},error:null});
 assert.deepEqual(await findWorklogReminderLinks(client,[rid,rid,'invalid'],()=>true),{[rid]:[sid]});assert.equal(reads,1);
});
