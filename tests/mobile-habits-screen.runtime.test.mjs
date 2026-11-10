import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {nativeComponentHarness,nativeNodes,nativeWords} from './helpers/native-component-harness.mjs';
register('./helpers/mobile-ts-loader.mjs',import.meta.url);
const model=await import('../mobile/src/features/habits/habit-model.ts'),date=await import('../mobile/src/features/home/home-calendar-model.ts'),theme=await import('../mobile/src/ui/theme.ts');
const today=date.seoulDate(),habit={id:'h',name:'독서',frequency:'weekly-target',weekdays:[],target:3,start_date:today,archived_at:null,version:0};
test('실제 습관 화면 10회 터치는 체크 요청 하나, 저장 확인 후 표시와 실행 취소, 실패 시 낙관적 성공 없음',async()=>{
 let resolve,calls=0,fail=false;const request=new Promise(r=>{resolve=r});
 const h=nativeComponentHarness('mobile/src/features/habits/habits-screen.tsx','HabitsScreen',{
  'expo-crypto':{randomUUID:()=> 'request'},'@/src/ui/theme':theme,'../home/home-calendar-model':date,'./habit-model':model,'./habit-store':{loadHabits:async()=>({habits:[habit],checks:[]}),mutateHabit:async(_client,_id,_request,version,command)=>{calls++;if(fail)throw Error('저장 확인 필요');await request;return{habit_id:'h',day:today,checked:command.checked,version:version+1};}},
 });
 const props={client:{}};h.render(props);await h.effects();
 const button=label=>nativeNodes(h.render(props)).find(n=>n.props?.accessibilityLabel===label);
 try{
  for(let i=0;i<10;i++)button('독서 오늘 체크').props.onPress();assert.equal(calls,1);assert.match(nativeWords(h.render(props)),/저장 중/);assert.doesNotMatch(nativeWords(h.render(props)),/1\s*\/\s*3\s*회/);
  resolve();await new Promise(r=>setImmediate(r));assert.match(nativeWords(h.render(props)),/1\s*\/\s*3\s*회/);
  button('독서 오늘 체크 취소').props.onPress();await new Promise(r=>setImmediate(r));assert.match(nativeWords(h.render(props)),/0\s*\/\s*3\s*회/);
  fail=true;button('독서 오늘 체크').props.onPress();await new Promise(r=>setImmediate(r));assert.match(nativeWords(h.render(props)),/저장 확인 필요/);assert.match(nativeWords(h.render(props)),/0\s*\/\s*3\s*회/);
 }finally{h.close()}
});

test('내 관리 영역은 세 구분만 보이고 선택한 한 영역만 렌더링',async()=>{
 const h=nativeComponentHarness('mobile/src/features/management/my-management-screen.tsx','MyManagementScreen',{'@/src/ui/theme':theme});
 const props={expenses:'지출 목록',recurring:'반복 목록',habits:'습관 목록'};
 let tree=h.render(props);assert.match(nativeWords(tree),/지출 목록/);assert.doesNotMatch(nativeWords(tree),/습관 목록/);
 const tabs=nativeNodes(tree).filter(n=>n.props?.accessibilityRole==='tab');assert.equal(tabs.length,3);tabs[2].props.onPress();
 tree=h.render(props);assert.match(nativeWords(tree),/습관 목록/);assert.doesNotMatch(nativeWords(tree),/지출 목록/);
});
