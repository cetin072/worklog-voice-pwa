import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./helpers/mobile-ts-loader.mjs',import.meta.url);
const m=await import('../mobile/src/features/habits/habit-model.ts');
const s=await import('../mobile/src/features/habits/habit-store.ts');
const habit={id:'h',name:'운동',frequency:'daily',weekdays:[],target:3,start_date:'2026-01-01',archived_at:null,version:0};
test('매일 운동·지정 요일·주3회 독서, 한 날 중복 방지·취소·주 변경',()=>{
 const checks=[{habit_id:'h',day:'2026-11-09',checked:true,version:0},{habit_id:'h',day:'2026-11-09',checked:true,version:0},{habit_id:'h',day:'2026-11-10',checked:false,version:1}];
 assert.deepEqual(m.habitProgress(habit,checks,'2026-11-10'),{count:1,target:7,todayChecked:false});
 assert.deepEqual(m.habitProgress({...habit,frequency:'weekly-target'},checks,'2026-11-10'),{count:1,target:3,todayChecked:false});
 assert.equal(m.habitDue({...habit,frequency:'weekdays',weekdays:[5]},'2026-11-10'),false);
 assert.deepEqual(m.habitProgress(habit,checks,'2026-11-16'),{count:0,target:7,todayChecked:false});assert.equal(checks.length,3,'과거 이력을 소비하거나 업무로 바꾸지 않음');
});
test('습관 저장 응답 유실은 같은 요청 영수증 읽기, 확인 불가면 성공 표시하지 않음',async()=>{
 let writes=0;const command={op:'check',day:'2026-11-10',checked:true},saved={habit_id:'h',day:'2026-11-10',checked:true,version:0};
 const builder={select(){return builder},eq(){return builder},maybeSingle:async()=>({data:{habit_id:'h',command:{checked:true,day:'2026-11-10',op:'check'},result:saved},error:null})};
 const client={auth:{getSession:async()=>({data:{session:{user:{id:'A'}}}})},rpc:async()=>{writes++;throw Error('timeout')},from:()=>builder};
 assert.deepEqual(await s.mutateHabit(client,'h','request',-1,command),saved);assert.equal(writes,1);
 builder.maybeSingle=async()=>({data:null,error:null});await assert.rejects(s.mutateHabit(client,'h','request',-1,command),/저장 확인 필요/);
});
