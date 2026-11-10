import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register('./helpers/mobile-ts-loader.mjs',import.meta.url);
const expenses=await import('../mobile/src/features/subscriptions/subscription-store.ts');
const repeats=await import('../mobile/src/features/recurring/recurrence-store.ts');
const habits=await import('../mobile/src/features/habits/habit-store.ts');
const model=await import('../mobile/src/features/recurring/recurrence-model.ts');
function query(result){const b={};for(const method of ['select','eq','order','limit','gte','lte','is'])b[method]=()=>b;b.then=(ok,bad)=>Promise.resolve(result).then(ok,bad);return b;}
test('서버 제한으로 일부만 반환된 반복/습관 목록은 완전한 스냅샷으로 취급하지 않음',async()=>{
 const state=model.newRepeatState('청소',{kind:'daily',anchor:'2026-11-10',interval:1,weekdays:[],unit:'day'});
 await assert.rejects(repeats.listRepeatingWork({from:()=>query({data:[{work_record_id:'w',version:0,state}],count:2,error:null})}),/전체/);
 await assert.rejects(habits.loadHabits({from:()=>query({data:[],count:1,error:null})},'2026-11-09','2026-11-15'),/조회 범위/);
});
test('납부 이력은 500건 경계를 넘어 읽고 중간에 총수가 바뀌면 확인 필요',async()=>{
 const all=Array.from({length:501},(_,i)=>({subscription_id:'s'+i,due_date:'2026-11-10'}));let changes=false,calls=0;
 const client={from(){const b={};for(const m of ['select','order'])b[m]=()=>b;b.range=async(from,to)=>{calls++;return{data:all.slice(from,to+1),count:changes&&from>0?502:501,error:null}};return b;}};
 assert.equal((await expenses.listPaymentReceipts(client)).length,501);assert.equal(calls,2);
 changes=true;await assert.rejects(expenses.listPaymentReceipts(client),/전체 확인/);
});
