import test from 'node:test';
import assert from 'node:assert/strict';
import {register,createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
register('./helpers/mobile-ts-loader.mjs',import.meta.url);
const { externalCalendarHook, read } = await import('./helpers/external-calendar-hook.mjs');
const api=await import('../mobile/src/features/calendar/personal-calendar-api.ts');
const config={dataSchema:'worklog',supabaseUrl:'https://synthetic.supabase.co',publishableKey:'synthetic-only'};
function access(){let current=true,actor='owner';const client={auth:{getSession:async()=>({data:{session:{access_token:'pinned-owner-token'}}}),getUser:async token=>{assert.equal(token,'pinned-owner-token');return{data:{user:{id:actor}}};}}};return{value:{client,config,ownerId:'owner',current:()=>current},actor:v=>actor=v,live:v=>current=v};}
test('shared RPC uses verified pinned token and same id; owner/schema change blocks requests and late results',async()=>{
 const a=access(),calls=[];const transport=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({id:'same-id'}),{status:200});};
 assert.deepEqual(await api.personalCalendarRequest(a.value,'save_my_calendar_event',{p_id:'same-id'},transport),{id:'same-id'});
 assert.equal(calls[0].url,config.supabaseUrl+'/rest/v1/rpc/save_my_calendar_event');assert.equal(calls[0].options.headers.authorization,'Bearer pinned-owner-token');assert.equal(JSON.parse(calls[0].options.body).p_id,'same-id');
 a.actor('other');await assert.rejects(api.personalCalendarRequest(a.value,'save_my_calendar_event',{},transport),/OWNER_CHANGED/);assert.equal(calls.length,1);
 a.actor('owner');await assert.rejects(api.personalCalendarRequest({...a.value,config:{...config,dataSchema:'public'}},'save_my_calendar_event',{},transport),/OWNER_CHANGED/);
 await assert.rejects(api.personalCalendarRequest(a.value,'get_my_calendar_month',{},async()=>{a.live(false);return new Response('{}');}),/OWNER_CHANGED/);
});
test('conflict and migration errors are explicit; month overlap includes spanning personal rows only',async()=>{
 const a=access();await assert.rejects(api.personalCalendarRequest(a.value,'save_my_calendar_event',{},async()=>new Response(JSON.stringify({message:'CALENDAR_CONFLICT'}),{status:409})),/CALENDAR_CONFLICT/);
 assert.match(api.personalCalendarMessage(Error('CALENDAR_CONFLICT')),/입력은 유지/);assert.match(api.personalCalendarMessage(Error('PGRST202')),/준비 중/);
 const data={events:[{id:'overlap',source:'personal',starts_at:'2026-10-31T12:00Z',ends_at:'2026-11-02T12:00Z'},{id:'point',source:'personal',starts_at:'2026-11-09T12:00Z',ends_at:null},{id:'outside',source:'personal',starts_at:'2026-12-01T00:00+09:00'},{id:'company',source:'notice',starts_at:'2026-11-09T12:00Z'}]};
 assert.deepEqual(api.personalEventsForMonth(data,'2026-11').map(x=>x.id),['overlap','point']);
});
test('actual calendar sheet saves a standalone all-day event, retains failed input, protects unsaved close and preserves metadata on edit',async()=>{
 const ts=createRequire(new URL('../mobile/package.json',import.meta.url))('typescript');
 let slots=[],cursor=0,effects=[],pendingEffects=[],calls=[],mode='failure',saved=0,closed=0,alert;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((x,i)=>x===b[i]);
 const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),useState:init=>{const i=cursor++;if(!(i in slots))slots[i]=typeof init==='function'?init():init;return[slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v];},useRef:init=>{const i=cursor++;if(!(i in slots))slots[i]={current:init};return slots[i];},useEffect:(fn,deps)=>{const i=cursor++;if(!same(effects[i]?.deps,deps)){pendingEffects.push(()=>{effects[i]?.cleanup?.();effects[i]={deps,cleanup:fn()};});}}};React.default=React;
 const native=Object.fromEntries(['ActivityIndicator','KeyboardAvoidingView','Modal','Pressable','ScrollView','Text','TextInput','View'].map(x=>[x,x]));native.AppState={addEventListener:()=>({remove(){}})};native.Platform={OS:'android'};native.StyleSheet={create:x=>x};native.Alert={alert:(...args)=>alert=args};
 const row={id:'existing',source:'personal',title:'ERP title',starts_at:'2026-11-09T10:00+09:00',ends_at:'2026-11-09T11:00+09:00',all_day:false,location:'Original place',description:'Original memo',updated_at:'revision',editable:true};
 const month=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit'}).format(new Date()).slice(0,7);
 row.starts_at=month+'-09T10:00+09:00';row.ends_at=month+'-09T11:00+09:00';
 const platform={client:{},config,session:{user:{id:'owner'}}};
 const boundary={...api,personalCalendarRequest:async(_access,name,body)=>{calls.push({name,body});if(name==='get_my_calendar_month')return{month,events:[row],limited:false};if(mode==='failure')throw Error('CALENDAR_CONFLICT');saved++;return{};}};
 let externalConnection=null;
 const externalHook=externalCalendarHook(React,native,()=>externalConnection);
 const exp={},code=ts.transpileModule(readFileSync('mobile/src/features/calendar/personal-calendar-sheet.tsx','utf8'),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS}}).outputText;
 new Function('React','require','exports',code)(React,m=>m==='react'?React:m==='react-native'?native:m.includes('datetimepicker')?{default:'Picker'}:m==='expo-crypto'?{randomUUID:()=> 'stable-request'}:m.includes('safe-area')?{useSafeAreaInsets:()=>({top:0,bottom:0})}:m.includes('use-external-calendar')?externalHook:m.endsWith('calendar-read')?read:m.includes('platform-provider')?{usePlatform:()=>platform}:m.includes('personal-calendar-api')?boundary:m.includes('record-row-styles')?{recordRowStyles:{taskTitle:'memoTitle',taskMeta:'memoMeta',inlineEdit:'memoEdit',inlineEditText:'memoEditText',inlineDelete:'memoDelete',inlineDeleteText:'memoDeleteText'}}:{mobileTheme:{colors:{}}},exp);
 function render(){cursor=0;const tree=exp.PersonalCalendarSheet({onSaved:()=>saved+=0,onClose:()=>closed++});const effects=pendingEffects;pendingEffects=[];effects.forEach(x=>x());return tree;}
 const all=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(all):[n,...all(n.props?.children)];const text=n=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props?.children):'';
 const button=label=>{const n=all(render()).find(n=>n.type==='Pressable'&&text(n)===label);assert.ok(n,'button '+label);return n;};
 const flush=()=>new Promise(r=>setImmediate(r));render();await flush();
 button('일정 등록').props.onPress();let title=all(render()).find(n=>n.type==='TextInput'&&n.props.accessibilityLabel==='제목');title.props.onChangeText('Independent event');button('일정 저장').props.onPress();await flush();assert.match(text(render()),/입력은 유지/);assert.equal(all(render()).find(n=>n.type==='TextInput'&&n.props.accessibilityLabel==='제목').props.value,'Independent event');
 const first=calls.find(x=>x.name==='save_my_calendar_event');assert.equal(first.body.p_all_day,true);assert.equal(first.body.p_expected_updated_at,null);assert.equal('p_record_type' in first.body,false);
 button('뒤로').props.onPress();assert.equal(alert[0],'입력을 닫을까요?');assert.equal(closed,0);
 mode='success';button('일정 저장').props.onPress();await flush();assert.equal(saved,1);assert.equal(calls.filter(x=>x.name==='save_my_calendar_event')[1].body.p_request_id,first.body.p_request_id,'retry reuses request');
 all(render()).find(n=>n.props?.accessibilityLabel===row.title+' 수정').props.onPress();title=all(render()).find(n=>n.type==='TextInput'&&n.props.accessibilityLabel==='제목');title.props.onChangeText('Changed in Worklog');button('일정 저장').props.onPress();await flush();const edit=calls.filter(x=>x.name==='save_my_calendar_event').at(-1).body;assert.equal(edit.p_id,'existing');assert.equal(edit.p_expected_updated_at,'revision');assert.equal(edit.p_description,'Original memo');assert.equal(edit.p_location,'Original place');assert.equal(edit.p_ends_at,month+'-09T11:00:00+09:00');
 all(render()).find(n=>n.props?.accessibilityLabel===row.title+' 삭제').props.onPress();assert.equal(alert[0],'개인 일정을 삭제할까요?');await alert[2][1].onPress();await flush();assert.equal(calls.find(x=>x.name==='cancel_my_calendar_event').body.p_id,'existing');
 row.editable=false;assert.equal(all(render()).filter(n=>n.type==='Pressable'&&n.props?.accessibilityLabel===row.title+' 수정').length,0);assert.match(text(render()),/연결된 업무에서/);
 const expiresAt=Date.now()+60000;
 externalConnection={info:()=>({expired:false,expiresAt}),status:()=>({generation:1}),readEvents:async()=>({events:[{...row,id:'external:one',source:'external',editable:false,title:'구글 전용 일정'}],limited:false})};
 render();await flush();assert.match(text(render()),/구글 전용 일정/);assert.match(text(render()),/Google · 읽기 전용/);
 assert.equal(all(render()).filter(n=>n.props?.accessibilityLabel==='구글 전용 일정 수정'||n.props?.accessibilityLabel==='구글 전용 일정 삭제').length,0);
 effects.forEach(x=>x?.cleanup?.());
});

test('home reads only the current owner’s personal schedules when the combined RPC is forbidden',async()=>{
 const a=access(), calls=[];
 const mock=async(url,options)=>{
  const u=new URL(url);calls.push({u,options});
  if(u.pathname.endsWith('/get_my_calendar_month')) return Response.json({message:'CALENDAR_FORBIDDEN'},{status:403});
  if(u.pathname.endsWith('/workspaces'))return Response.json([{id:'personal-workspace'}]);
  if(u.pathname.endsWith('/workspace_members'))return Response.json([{role:'owner'}]);
  return Response.json([{id:'standalone',title:'Own',starts_at:'2026-11-01T00:00:00+09:00'}]);
 };
 const outcome=await api.readHomeCalendarMonth(a.value,'2026-11',mock);
 assert.equal(outcome.personalOnly,true);assert.equal(outcome.limited,true);assert.equal(outcome.events[0].editable,false);
 assert.deepEqual(calls.map(({u})=>u.pathname.split('/').at(-1)),['get_my_calendar_month','workspaces','workspace_members','schedules']);
 for(const {options} of calls.slice(1)){assert.equal(options.method,'GET');assert.equal(options.headers['Accept-Profile'],'worklog');assert.equal(options.headers.authorization,'Bearer pinned-owner-token');}
 assert.equal(calls[1].u.searchParams.get('owner_user_id'),'eq.owner');
 assert.equal(calls[1].u.searchParams.get('kind'),'eq.personal');
 assert.equal(calls[2].u.searchParams.get('user_id'),'eq.owner');
 assert.equal(calls[2].u.searchParams.get('role'),'eq.owner');
 assert.equal(calls[3].u.searchParams.get('workspace_id'),'eq.personal-workspace');
 assert.equal(calls[3].u.searchParams.get('created_by_user_id'),'eq.owner');
 assert.match(calls[3].u.searchParams.get('or'),/2026-11-01T00:00:00\+09:00/);
});
test('home never falls back without owner membership or for a different RPC error',async()=>{
 const a=access();
 let calls=0;
 await assert.rejects(api.readHomeCalendarMonth(a.value,'2026-11',async()=>{
   calls++;return Response.json({message:'CALENDAR_UNAVAILABLE'},{status:503});
 }),/CALENDAR_UNAVAILABLE/);
 assert.equal(calls,1);
 await assert.rejects(api.readHomeCalendarMonth(a.value,'2026-11',async(url)=>{
   calls++;if(url.includes('/rpc/'))return Response.json({message:'CALENDAR_FORBIDDEN'},{status:403});
   if(url.includes('/workspaces?'))return Response.json([{id:'w'}]);
   if(url.includes('/workspace_members?'))return Response.json([]);
   assert.fail('schedules must not be read without owner membership');
 }),/CALENDAR_FORBIDDEN/);
 assert.equal(calls,4);
});
test('home discards a late personal request after the account changes',async()=>{
 const a=access();
 await assert.rejects(api.readHomeCalendarMonth(a.value,'2026-11',async(url)=>{
   if(url.includes('/rpc/'))return Response.json({message:'CALENDAR_FORBIDDEN'},{status:403});
   a.live(false);return Response.json([{id:'w'}]);
 }),/CALENDAR_OWNER_CHANGED/);
});
