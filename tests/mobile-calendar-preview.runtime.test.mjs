import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, register } from 'node:module';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const {createCalendarConnection}=await import('../mobile/src/features/calendar/calendar-connection.ts');
const sourceModule=await import('../mobile/src/features/calendar/calendar-source.ts');
const ts=createRequire(new URL('../mobile/package.json',import.meta.url))('typescript');

test('settings owns OAuth; disconnected schedules are hidden; mounted export reads shared connection',async(t)=>{
  const previous=process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT;
  t.after(()=>{if(previous===undefined)delete process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT;else process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT=previous;});
  process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT='qa';
  const row={id:'22222222-2222-4222-8222-222222222222',workspace_id:'workspace',created_by_user_id:'owner',title:'합성 일정',status:'confirmed',starts_at:'2026-11-02T10:00:00+09:00',ends_at:null,all_day:false,timezone:'Asia/Seoul',updated_at:'2026-10-31T01:00:00Z'};
  let connects=0,posts=0,stored=null,finish;
  const target={accountId:'google-id',calendarId:'primary'};
  const service=createCalendarConnection({authorize:async()=>{connects++;await new Promise(r=>finish=r);return {target,email:'qa@example.invalid',expiresAt:Date.now()+60000,adapter:{target,get:async()=>stored,insert:async(id,draft)=>{posts++;stored={id,draft,status:'confirmed',sourceId:draft.scheduleId};return stored;}}};}});
  const query={select:()=>query,eq:()=>query,single:async()=>({data:row})};
  const platform={config:{},session:{user:{id:'owner'}},client:{auth:{getUser:async()=>({data:{user:{id:'owner'}}})},from:()=>query}};
  const all=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(all):[n,...all(n.props.children)];
  const text=n=>all(n).filter(n=>n.type==='Text').flatMap(n=>n.props.children).filter(v=>typeof v==='string').join(' ');
  function component(path, name, props={}) {
    let slots=[],cursor=0;
    const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),
      useState:init=>{const i=cursor++;if(!(i in slots))slots[i]=typeof init==='function'?init():init;return[slots[i],next=>slots[i]=typeof next==='function'?next(slots[i]):next];},
      useRef:init=>{const i=cursor++;if(!(i in slots))slots[i]={current:init};return slots[i];},useEffect:()=>{}};React.default=React;
    const native=Object.fromEntries(['Image','Modal','Pressable','ScrollView','Text','View'].map(k=>[k,k]));native.StyleSheet={create:v=>v};
    const exp={};const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS}}).outputText;
    new Function('require','exports',code)(mod=>mod==='react'?React:mod==='react/jsx-runtime'?{}:mod==='react-native'?native:mod.includes('home-reminder-status')?{useCalendarScheduleId:()=>row.id}:mod.includes('use-calendar-connection')?{useCalendarConnection:()=>service}:mod.includes('calendar-end-picker')?{CalendarEndPicker:'CalendarEndPicker',calendarDateLabel:()=> '2026년 11월 2일 오전 10시'}:mod.includes('platform-provider')?{usePlatform:()=>platform}:mod.includes('snapshot')?{reminderSessionEpoch:{capture:()=>()=>true}}:mod.includes('calendar-source')?sourceModule:{CALENDAR_PERMISSION_NOTICE:'선택한 일정 한 건'},exp);
    return ()=>{cursor=0;return exp[name](props);};
  }
  const render=component('mobile/src/features/calendar/calendar-export-preview.tsx','CalendarExportPreview',{scheduleId:row.id,title:'snapshot'});
  const settings=component('mobile/src/features/settings/calendar-settings.tsx','CalendarSettings');
  const button=(render,label)=>all(render()).find(n=>n.type==='Pressable'&&(text(n).includes(label)||n.props.accessibilityLabel?.includes(label)));
  const flush=()=>new Promise(r=>setImmediate(r));
  assert.equal(render(),null);assert.equal(connects,0);
  button(settings,'Google 캘린더 연결').props.onPress();assert.equal(service.status().connecting,true);
  // The old settings view can disappear while the browser is open.
  finish();await flush();assert.equal(connects,1);assert.match(text(settings()),/연결됨/);
  const remountedSettings=component('mobile/src/features/settings/calendar-settings.tsx','CalendarSettings');
  assert.match(text(remountedSettings()),/qa@example.invalid/);assert.equal(posts,0);
  button(render,'Google 캘린더에 보내기').props.onPress();await flush();
  assert.equal(button(render,'확인한 일정').props.disabled,true);
  const picker=all(render()).find(n=>n.type==='CalendarEndPicker');
  picker.props.onChange(row.starts_at);
  assert.equal(button(render,'확인한 일정').props.disabled,true);assert.match(text(render()),/종료 시각은 시작 시각보다 늦어야/);assert.equal(posts,0);
  button(render,'30분').props.onPress();assert.equal(button(render,'확인한 일정').props.disabled,false);
  picker.props.onChange('2026-11-02T02:00:00Z');
  assert.equal(button(render,'확인한 일정').props.disabled,false);
  button(render,'확인한 일정').props.onPress();await flush();assert.equal(posts,1);assert.match(text(render()),/등록 완료/);
  button(render,'확인한 일정').props.onPress();await flush();assert.equal(posts,1);assert.match(text(render()),/이미 등록/);
  assert.equal(all(render()).some(n=>n.type==='TextInput'),false);
  button(render,'닫기').props.onPress();assert.equal(service.info().email,'qa@example.invalid');
  button(settings,'연결 해제').props.onPress();assert.equal(service.info(),null);assert.equal(render(),null);
  process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT='production';assert.equal(settings(),null);assert.equal(render(),null);
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
  const rows=new Function('React','styles','formatSchedule','ScheduleReminderLabel','CalendarExportPreview','View','Text',code+';return ScheduleRows;')(React,{},()=>'', 'ScheduleReminderLabel','CalendarExportPreview','View','Text');
  const all=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(all):[n,...all(n.props.children)];
  const tree=rows({schedules:brief.schedules.today,empty:'none',onReminder(){}});
  const entries=all(tree).filter(n=>n.type==='CalendarExportPreview');
  assert.equal(entries.length,1);assert.equal(entries[0].props.scheduleId,brief.schedules.today[0].scheduleId);
  assert.equal(all(rows({schedules:[{...brief.schedules.today[0],status:'confirmed'}],empty:'none',onReminder(){}})).filter(n=>n.type==='CalendarExportPreview').length,1);
});

