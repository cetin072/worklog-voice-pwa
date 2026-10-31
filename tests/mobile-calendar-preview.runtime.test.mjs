import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, register } from 'node:module';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const {createCalendarConnection}=await import('../mobile/src/features/calendar/calendar-connection.ts');
const sourceModule=await import('../mobile/src/features/calendar/calendar-source.ts');
const ts=createRequire(new URL('../mobile/package.json',import.meta.url))('typescript');

test('actual QA UI opens server preview, connects only on click, confirms one event and closes safely',async(t)=>{
  const previous=process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT;
  t.after(()=>{if(previous===undefined)delete process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT;else process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT=previous;});
  process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT='qa';
  const row={id:'22222222-2222-4222-8222-222222222222',workspace_id:'workspace',created_by_user_id:'owner',title:'긴 제목 '.repeat(20),status:'confirmed',starts_at:'2026-11-02T10:00:00+09:00',ends_at:null,all_day:false,timezone:'Asia/Seoul',updated_at:'2026-10-31T01:00:00Z'};
  let connects=0,posts=0,stored=null,authorizationPause=null,cleanup=null;
  const target={accountId:'google-id',calendarId:'primary'};
  const service=createCalendarConnection({authorize:async()=>{connects++;if(authorizationPause)await authorizationPause;return {target,email:'qa@example.invalid',expiresAt:Date.now()+60000,adapter:{target,get:async()=>stored,insert:async(id,draft)=>{posts++;stored={id,draft:{...draft,title:draft.title.trim()},status:'confirmed',sourceId:draft.scheduleId};return stored;}}};}});
  const query={select:()=>query,eq:()=>query,single:async()=>({data:row})};
  const platform={config:{},session:{user:{id:'owner'}},client:{auth:{getUser:async()=>({data:{user:{id:'owner'}}})},from:()=>query}};
  let slots=[],cursor=0;
  const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),
    useState:init=>{const i=cursor++;if(!(i in slots))slots[i]=init;return[slots[i],next=>slots[i]=typeof next==='function'?next(slots[i]):next];},
    useRef:init=>{const i=cursor++;if(!(i in slots))slots[i]={current:init};return slots[i];},useEffect:fn=>{if(!cleanup)cleanup=fn();}};
  React.default=React;
  const native=Object.fromEntries(['Modal','Pressable','ScrollView','Text','TextInput','View'].map(k=>[k,k]));native.StyleSheet={create:v=>v};
  const exports={};
  const compiled=ts.transpileModule(readFileSync('mobile/src/features/calendar/calendar-export-preview.tsx','utf8'),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS}}).outputText;
  new Function('require','exports',compiled)(name=>name==='react'?React:name==='react-native'?native:name.includes('platform-provider')?{usePlatform:()=>platform}:name.includes('snapshot')?{reminderSessionEpoch:{capture:()=>()=>true}}:name==='./calendar-source'?sourceModule:{calendarConnection:()=>service,CALENDAR_PERMISSION_NOTICE:'소유 일정 조회·생성·수정·삭제 권한'},exports);
  const render=()=>{cursor=0;return exports.CalendarExportPreview({scheduleId:row.id,title:'브리핑 스냅샷'});};
  const all=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(all):[node,...all(node.props.children)];
  const text=node=>all(node).filter(n=>n.type==='Text').flatMap(n=>n.props.children).filter(v=>typeof v==='string').join(' ');
  const button=label=>all(render()).find(n=>n.type==='Pressable'&&text(n).includes(label));
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  render();assert.equal(connects,0);assert.equal(posts,0);
  button('Google 캘린더 · 연결 준비').props.onPress();await flush();
  assert.equal(all(render()).find(n=>n.type==='Modal').props.visible,true);
  assert.match(JSON.stringify(render()),/긴 제목/);assert.match(JSON.stringify(render()),/Asia\/Seoul/);
  assert.equal(button('확인한 일정').props.disabled,true);assert.equal(connects,0);
  button('계정 연결 (선택)').props.onPress();await flush();assert.equal(connects,1);assert.equal(posts,0);
  all(render()).find(n=>n.type==='TextInput').props.onChangeText('2026-11-02T11:00:00+09:00');
  assert.equal(button('확인한 일정').props.disabled,false);
  button('확인한 일정').props.onPress();await flush();assert.equal(posts,1);assert.match(JSON.stringify(render()),/등록 완료/);
  button('확인한 일정').props.onPress();await flush();assert.equal(posts,1);assert.match(JSON.stringify(render()),/이미 등록/);
  assert.ok(all(render()).some(n=>n.type==='ScrollView'));assert.ok(all(render()).filter(n=>n.type==='Text').every(n=>n.props.numberOfLines===undefined));
  assert.equal(button('닫기').props.style.minHeight,48);
  all(render()).find(n=>n.type==='Modal').props.onRequestClose();assert.equal(all(render()).find(n=>n.type==='Modal').props.visible,false);
  let finishAuthorization;authorizationPause=new Promise(resolve=>finishAuthorization=resolve);
  button('다른 Google 계정 연결').props.onPress();cleanup();finishAuthorization();await flush();
  assert.equal(service.info().email,'qa@example.invalid');assert.equal(posts,1);
  for(const variant of ['production',undefined]){if(variant===undefined)delete process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT;else process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT=variant;assert.equal(render(),null);}
});

test('real server confirmed projection reaches actual Home Calendar entry; tentative schedules do not',async()=>{
  const {createWorklogDataCoreBriefingSource}=await import('../netlify/shared/worklog-data-core-briefing-source.mjs');
  const brief=await createWorklogDataCoreBriefingSource({client:{rpc:async()=>({workspace_id:'synthetic-workspace',today:'2026-11-02',tasks:[],schedules:[
    {id:'22222222-2222-4222-8222-222222222222',title:'확정 검수',starts_at:'2026-11-02T10:00:00+09:00',status:'confirmed'},
    {id:'33333333-3333-4333-8333-333333333333',title:'임시 검수',starts_at:'2026-11-02T11:00:00+09:00',status:'tentative'},
  ]})}}).load();
  assert.equal(brief.schedules.today[0].status,'확정');
  const file=ts.createSourceFile('index.tsx',readFileSync('mobile/app/index.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const node=file.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text==='ScheduleRows');assert.ok(node);
  const code=ts.transpileModule(ts.createPrinter().printNode(ts.EmitHint.Unspecified,node,file),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS}}).outputText;
  const React={createElement:(type,props,...children)=>({type,props:{...props,children}})};
  const rows=new Function('React','styles','formatSchedule','ScheduleReminderLabel','CalendarExportPreview',code+';return ScheduleRows;')(React,{},()=>'', 'ScheduleReminderLabel','CalendarExportPreview');
  const all=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(all):[n,...all(n.props.children)];
  const tree=rows({schedules:brief.schedules.today,empty:'none',onReminder(){}});
  const entries=all(tree).filter(n=>n.type==='CalendarExportPreview');
  assert.equal(entries.length,1);assert.equal(entries[0].props.scheduleId,brief.schedules.today[0].scheduleId);
  assert.equal(all(rows({schedules:[{...brief.schedules.today[0],status:'confirmed'}],empty:'none',onReminder(){}})).filter(n=>n.type==='CalendarExportPreview').length,1);
});
