import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./helpers/mobile-ts-loader.mjs',import.meta.url);
const {mutateRepeatingWork}=await import('../mobile/src/features/recurring/recurrence-store.ts');
const {recurringHomeProjection}=await import('../mobile/src/features/recurring/recurrence-home.ts');
const {newRepeatState}=await import('../mobile/src/features/recurring/recurrence-model.ts');
const {recurringCalendarEvents}=await import('../mobile/src/features/recurring/recurrence-calendar.ts');
const {planRepeatReminders}=await import('../mobile/src/features/recurring/recurrence-reminder-plan.ts');
const state=newRepeatState('청소',{kind:'weekly',anchor:'2026-11-06',interval:1,weekdays:[5],unit:'day'},'09:00');
const work={workRecordId:'w',version:0,state};
test('홈은 일반 업무와 반복 회차를 합치고 원본 중복 숨김, 달력/알림은 동일 계산 소비',()=>{
 const p=recurringHomeProjection({today:[{pageId:'normal',title:'원래 업무'},{pageId:'w',title:'원본'}],overdue:[],upcoming:[],undated:[]},[work],'2026-11-13');
 assert.equal(p.structure.today.length,2);assert.equal(p.structure.today[0].pageId,'normal');assert.equal(p.structure.overdue.length,1);assert.equal(p.occurrences.size,14);
 assert.equal(recurringCalendarEvents([work],'2026-11').length,4);
 const plan=planRepeatReminders([work],'A','2026-11-13',Date.parse('2026-11-13T00:00:00+09:00'));assert.ok(plan.length);assert.equal(new Set(plan.map(p=>p.identifier)).size,plan.length);
 assert.equal(planRepeatReminders([{...work,state:{...state,revisions:state.revisions.map(r=>({...r,time:''}))}}],'A','2026-11-13',0).length,0);
});
test('응답 유실 후 동일 요청 읽기, jsonb 키 순서 변화 허용, 불명확한 저장/계정 변경 실패',async()=>{
 const command={op:'complete',key:'v1:2026-11-13',originalDate:'2026-11-13'};const saved={work_record_id:'w',version:1,state};let owner='A';
 const b={select(){return b},eq(){return b},maybeSingle:async()=>({data:{work_record_id:'w',command:{originalDate:'2026-11-13',key:'v1:2026-11-13',op:'complete'},result:saved},error:null})};
 const client={auth:{getSession:async()=>({data:{session:{user:{id:owner}}}})},rpc:async()=>{throw Error('timeout')},from:()=>b};
 assert.equal((await mutateRepeatingWork(client,'w','id',0,command)).version,1);
 b.maybeSingle=async()=>({data:null,error:null});await assert.rejects(mutateRepeatingWork(client,'w','id',0,command),/저장 확인 필요/);
 client.rpc=async()=>{owner='B';return {data:saved,error:null}};await assert.rejects(mutateRepeatingWork(client,'w','id',0,command),/계정이 바뀌어/);
});
