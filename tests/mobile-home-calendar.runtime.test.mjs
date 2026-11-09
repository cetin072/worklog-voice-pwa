import test from 'node:test';
import assert from 'node:assert/strict';
import { register, createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const model = await import('../mobile/src/features/home/home-calendar-model.ts');
const { homeHarness, nodes, words } = await import('./helpers/mobile-home-harness.mjs');
const event = (id, start, end = null, extra = {}) => ({ id, source: 'personal', title: id, starts_at: start, ends_at: end, all_day: false, status: 'confirmed', ...extra });
test('calendar dates use Seoul, Monday weeks and complete leap/month/year boundaries', () => {
 assert.equal(model.seoulDate('2026-11-08T15:00:00Z'), '2026-11-09');
 assert.deepEqual(model.calendarDays('2026-11-01', false), ['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01']);
 assert.equal(model.calendarDays('2024-02-10', true).filter(Boolean).length, 29);
 assert.equal(model.calendarDays('2026-11-09', true).length, 42);
 assert.equal(model.shiftMonth('2026-12-31', 1), '2027-01-01');
 assert.equal(model.calendarDays('2027-01-01', false)[0], '2026-12-28');
});
test('duration overlap is end-exclusive, deduplicated and private; point events keep Seoul midnight', () => {
 const span = event('span', '2026-10-31T00:00:00+09:00', '2026-11-02T00:00:00+09:00', { all_day: true });
 const rows = [span, span, event('midnight','2026-10-31T15:00:00Z'), event('company','2026-11-01T10:00:00+09:00',null,{source:'notice'}), event('cancelled','2026-11-01T10:00:00+09:00',null,{status:'cancelled'}), event('bad','invalid')];
 assert.deepEqual(model.eventsOnDay(rows,'2026-11-01').map(r=>r.id), ['span','midnight']);
 assert.deepEqual(model.eventsOnDay(rows,'2026-11-02'), []);
 assert.equal(model.calendarTime(span,'2026-11-01'),'종일');
 assert.equal(model.calendarTime(event('span','2026-10-31T23:00+09:00','2026-11-02T01:00+09:00'),'2026-11-01'),'계속');
});
function calendarHarness(request) {
 const ts=createRequire(new URL('../mobile/package.json',import.meta.url))('typescript');
 const slots=[], effects=[];let cursor=0, pending=[];
 const element=(type,props,...children)=>({type,props:{...props,children}});
 const React={createElement:element,useState(init){const i=cursor++;if(!(i in slots))slots[i]=typeof init==='function'?init():init;return[slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v];},useRef(init){const i=cursor++;return slots[i]||=( {current:init} );},useEffect(fn,deps){const i=cursor++;if(!effects[i]||deps.some((v,j)=>v!==effects[i].deps[j]))pending.push(()=>{effects[i]?.cleanup?.();effects[i]={deps,cleanup:fn()};});}};
 const native={...Object.fromEntries(['ActivityIndicator','Pressable','Text','View'].map(x=>[x,x])),StyleSheet:{create:x=>x},AppState:{addEventListener:()=>({remove(){}})}};
 const platform={client:{},config:{dataSchema:'worklog'},session:{user:{id:'owner'}}};
 const props={today:'2026-11-30',revision:0,fallback:[],onOpenCalendar:()=>{},onTodayCount:()=>{},renderSchedule:s=>element('Text',{},s.title)};
 const exp={},code=ts.transpileModule(readFileSync('mobile/src/features/home/home-calendar.tsx','utf8'),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS}}).outputText;
 new Function('React','require','exports',code)(React,name=>name==='react'?React:name==='react-native'?native:name.includes('platform-provider')?{usePlatform:()=>platform}:name.includes('personal-calendar-api')?{personalCalendarRequest:request,personalCalendarMessage:()=> '일정 조회 실패'}:name.includes('home-calendar-model')?model:{mobileTheme:{colors:{}}},exp);
 return {props,platform,render(){cursor=0;const tree=exp.HomeCalendar(props);const run=pending;pending=[];run.forEach(f=>f());return tree;},close(){effects.forEach(e=>e?.cleanup?.());}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const button=(h,label)=>{const n=nodes(h.render()).find(n=>n.type==='Pressable'&&(n.props.accessibilityLabel===label||words(n).trim()===label));assert.ok(n,'button '+label);return n;};
test('actual Home calendar loads both months of a crossing week, selects dates, expands and rejects late owner results', async () => {
 const calls=[],waiting=[];const h=calendarHarness((access,name,body)=>new Promise(resolve=>{calls.push({access,name,body});waiting.push(resolve);}));
 let count;h.props.onTodayCount=value=>count=value;
 h.render();assert.deepEqual(calls.map(c=>c.body.p_month),['2026-11-01','2026-12-01']);
 waiting[0]({events:[event('seam','2026-11-30T10:00+09:00')],limited:false});waiting[1]({events:[event('dec','2026-12-01T10:00+09:00')],limited:false});await flush();h.render();h.render();assert.equal(count,1);assert.match(words(h.render()),/seam/);
 button(h,'2026-12-01 일정 있음').props.onPress();assert.match(words(h.render()),/dec/);
 // Selecting inside the same week needs no new RPC.
 assert.equal(calls.length,2);
 button(h,'월 보기 ⌄').props.onPress();h.render();assert.equal(calls.length,3);
 h.platform.session={user:{id:'other'}};h.render();assert.equal(calls[2].access.current(),false);
 waiting[2]({events:[event('old private','2026-12-01T10:00+09:00')],limited:false});await flush();assert.doesNotMatch(words(h.render()),/old private/);
 waiting[3]({events:[],limited:false});await flush();assert.match(words(h.render()),/등록된 일정이 없습니다/);h.close();
});
test('failed/limited month never claims complete emptiness; verified briefing remains usable and retry works', async () => {
 let fail=true;const h=calendarHarness(async()=>{if(fail)throw Error('offline');return {events:[],limited:true};});
 h.props.today='2026-11-09';h.props.fallback=[{scheduleId:'known',title:'known appointment',startsAt:'2026-11-09T10:00+09:00'}];
 h.render();await flush();assert.match(words(h.render()),/일정 조회 실패/);assert.match(words(h.render()),/known appointment/);assert.doesNotMatch(words(h.render()),/등록된 일정이 없습니다/);
 button(h,'known appointment 일정 상세').props.onPress();assert.match(words(h.render()),/known appointment/);
 fail=false;button(h,'일정 다시 불러오기').props.onPress();h.render();await flush();assert.match(words(h.render()),/일부 일정만/);assert.doesNotMatch(words(h.render()),/등록된 일정이 없습니다/);h.close();
});
test('actual Home shows schedule before actionable tasks and moves tools after them; task expansion preserves edit/delete/undo',()=>{
 const task={pageId:'t',title:'견적서 검토'};let complete=0,edit=0,remove=0,undo=0,reminders=0,settings=0;
 const h=homeHarness({setReminderTarget:()=>reminders++,setScreen:screen=>{assert.equal(screen,'settings');settings++;},CalendarExportPreview:props=>({type:'CalendarExportPreview',props}),briefing:{today:'2026-11-09'},structure:{today:[task],overdue:[],upcoming:[],undated:[]},activeFilter:'today',completeTaskInline:()=>complete++,openTaskEditor:()=>edit++,confirmDeleteRecord:()=>remove++,undoTask:{title:task.title},undoCompletedTask:()=>undo++});
 const tree=h.render(),all=nodes(tree);const idx=label=>all.findIndex(n=>n.props?.accessibilityLabel===label);
 assert.ok(all.findIndex(n=>n.type==='HomeCalendar')<idx('견적서 검토 완료 처리'));
 assert.ok(idx('견적서 검토 완료 처리')<all.findIndex(n=>n.props?.label==='캡처 등록'));
 const action=label=>nodes(h.render()).find(n=>n.props?.accessibilityLabel===label);
 assert.equal(words(action('견적서 검토 완료 처리')).trim(),'완료');
 assert.doesNotMatch(words(h.render()),/□/);
 action('견적서 검토 알림 확인 필요').props.onPress();assert.equal(reminders,1);
 assert.equal(nodes(h.render()).filter(n=>n.type==='CalendarExportPreview').length,0);assert.equal(settings,0);
 action('견적서 검토 완료 처리').props.onPress();assert.equal(complete,1);
 assert.equal(action('견적서 검토 삭제'),undefined);action('견적서 검토 관리 펼치기').props.onPress();
 assert.equal(nodes(h.render()).filter(n=>n.type==='CalendarExportPreview').length,0);
 action('견적서 검토 수정').props.onPress();action('견적서 검토 삭제').props.onPress();assert.equal(edit,1);assert.equal(remove,1);
 const undoButton=nodes(h.render()).find(n=>n.type==='Pressable'&&words(n).trim()==='실행 취소');undoButton.props.onPress();assert.equal(undo,1);
});
