import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {nativeComponentHarness} from './helpers/native-component-harness.mjs';
register('./helpers/mobile-ts-loader.mjs',import.meta.url);
const dates=await import('../mobile/src/features/home/home-calendar-model.ts');
const epochs=await import('../mobile/src/features/schedule/schedule-reminder-snapshot.ts');
const model=await import('../mobile/src/features/recurring/recurrence-model.ts');
const work={workRecordId:'w',version:0,state:model.newRepeatState('청소',{kind:'daily',anchor:dates.seoulDate(),interval:1,weekdays:[],unit:'day'})};
test('인증/초기 조회 실패는 기존 알림을 비우지 않고 늦은 재조회는 완료 결과를 덮지 않음',async()=>{
 let reject,resolveSlow;let list=()=>new Promise((_r,j)=>{reject=j});let reservations=0,ownerChecks=0,cancels=0;
 const h=nativeComponentHarness('mobile/src/features/recurring/use-repeating-work.ts','useRepeatingWork',{
  'expo-crypto':{randomUUID:()=> 'request'},'../home/home-calendar-model':dates,'../schedule/schedule-reminder-snapshot':epochs,
  './recurrence-reminders':{syncRepeatReminders:async()=>{reservations++},cancelAllRepeatReminders:async()=>{cancels++},reconcileRepeatReminderOwner:async()=>{ownerChecks++}},
  './recurrence-store':{listRepeatingWork:()=>list(),mutateRepeatingWork:async()=>({...work,version:1})},
 });
 const client={};try{
  h.call(client,'A',false);await h.effects();assert.equal(reservations,0);assert.equal(cancels,0);assert.equal(ownerChecks,0);
  h.call(client,'A',true);await h.effects();reject(Error('offline'));await new Promise(r=>setImmediate(r));
  h.call(client,'A',true);await h.effects();assert.equal(reservations,0,'조회 실패를 빈 목록으로 해석해 OS 알림 취소 금지');
  list=async()=>[work];await h.call(client,'A',true).reload();h.call(client,'A',true);await h.effects();assert.equal(reservations,1);
  list=()=>new Promise(r=>{resolveSlow=r});const pending=h.call(client,'A',true).reload();
  await h.call(client,'A',true).mutate('w',{op:'complete',key:'v1:2026-11-10',originalDate:'2026-11-10'});
  resolveSlow([work]);await pending;assert.equal(h.call(client,'A',true).works[0].version,1);assert.equal(cancels,0);
 }finally{h.close()}
});
