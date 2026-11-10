import test from 'node:test';
import assert from 'node:assert/strict';
import {managementPanel,managementBackHandler} from './helpers/management-panel-harness.mjs';
import {nativeNodes,nativeWords} from './helpers/native-component-harness.mjs';

test('실제 내 관리 반복 패널은 초기 로딩·빈 목록·조회 실패를 구분하고 같은 화면에서 재확인',()=>{
 let retries=0;
 const recurring={works:[],loaded:false,error:'',busy:false,retry(){retries++;}};
 const render=()=>managementPanel({recurring,styles:{},setRepeatRule(){},setScreen(){}});
 assert.match(nativeWords(render()),/불러오는 중/);
 assert.doesNotMatch(nativeWords(render()),/한 번 설정하세요/);
 recurring.error='서버 준비 상태 확인 필요';recurring.loaded=true;
 assert.match(nativeWords(render()),/서버 준비 상태 확인 필요/);
 assert.doesNotMatch(nativeWords(render()),/한 번 설정하세요|불러오는 중/);
 nativeNodes(render()).find(n=>n.props?.title==='반복 업무 다시 확인').props.onPress();
 assert.equal(retries,1);
 recurring.error='';assert.match(nativeWords(render()),/한 번 설정하세요/);
 assert.equal(nativeNodes(render()).some(n=>n.props?.title==='반복 업무 다시 확인'),false);
});

test('실제 뒤로가기 핸들러는 내 관리 진입점으로 복귀하고 미확정 음성을 먼저 보호',()=>{
 for(const origin of ['home','settings']){
  let handler,destination,warned=0;
  const context={screen:'subscriptions',managementReturn:origin,quickVoiceNavigation:{current:false},
   warnPendingVoice(){warned++;},setScreen(value){destination=value;},useEffect(fn){fn();},
   BackHandler:{addEventListener(_event,fn){handler=fn;return{remove(){}};}}};
  managementBackHandler(context);
  assert.equal(handler(),true);assert.equal(destination,origin);
  destination=undefined;context.quickVoiceNavigation.current=true;
  assert.equal(handler(),true);assert.equal(destination,undefined);assert.equal(warned,1);
 }
});
