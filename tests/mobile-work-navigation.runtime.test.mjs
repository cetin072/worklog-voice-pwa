import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {nativeNodes,nativeWords} from './helpers/native-component-harness.mjs';
const ts=createRequire(new URL('../mobile/package.json',import.meta.url))('typescript');
const source=readFileSync('mobile/app/index.tsx','utf8');
const ast=ts.createSourceFile('home.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let tabs, dock, navigate;
function walk(node){if(ts.isConditionalExpression(node)&&ts.isJsxElement(node.whenTrue)&&node.whenTrue.openingElement.getText(ast).includes('styles.quickVoiceFooter'))dock=node.getText(ast);if(ts.isFunctionDeclaration(node)&&node.name?.text==='setScreen')navigate=node.getText(ast);if(ts.isJsxElement(node)&&node.openingElement.getText(ast).includes('styles.bottomTabs'))tabs=node.getText(ast);ts.forEachChild(node,walk);}
walk(ast);
test('actual bottom navigation has only Home/Work, calls guarded navigation and preserves safe-area dock clearance',()=>{
 assert.ok(tabs);
 const js=ts.transpileModule(`return (${tabs});`,{compilerOptions:{jsx:ts.JsxEmit.React}}).outputText;
 const visited=[];
 const scope={React:{createElement:(type,props,...children)=>({type,props:{...props,children}})},View:'View',Text:'Text',Pressable:'Pressable',styles:{},screen:'work',insets:{bottom:20},setWorkDestination:()=>{},setScreen:screen=>visited.push(screen)};
 const tree=new Function('scope',`with(scope){${js}}`)(scope);
 const buttons=nativeNodes(tree).filter(n=>n.props?.accessibilityRole==='tab');
 assert.deepEqual(buttons.map(n=>nativeWords(n).trim()),['홈','업무']);
 assert.equal(buttons[1].props.accessibilityState.selected,true);
 buttons.forEach(n=>n.props.onPress());assert.deepEqual(visited,['home','work']);
 assert.equal(tree.props.style[1].paddingBottom,20);

 assert.match(source,/bottomTabs: \{ flexShrink: 0/);
 assert.match(source,/paddingBottom: showQuickVoice \? QUICK_VOICE_LAYOUT\.dockReserveHeight \+ 32 : 16/);
 assert.match(source,/onOpenManagement=\{\(\)=>\{setManagementReturn\('home'\);setScreen\('subscriptions'\);\}\}/);
});

test('both tabs use the same voice dock and existing save/refresh flow',async()=>{
 assert.ok(dock);
 const js=ts.transpileModule(`return (${dock});`,{compilerOptions:{jsx:ts.JsxEmit.React}}).outputText;
 for(const screen of ['home','work','settings']){
  let saves=0,refreshes=0,feedback;
  const scope={React:{createElement:(type,props,...children)=>({type,props:{...props,children}})},View:'View',VoiceRecorderCard:'VoiceRecorderCard',CaptureImportButton:'CaptureImportButton',styles:{},insets:{bottom:20},screen,showQuickVoice:screen==='home'||screen==='work',androidTouchSmoke:false,FORCE_WHISPER_FALLBACK_QA_MODE:false,prepareQuickVoiceWhisperProvider:()=>{},QUICK_VOICE_SPEECH_RECOGNITION:{},quickVoiceNavigation:{current:false},session:{user:{id:'owner'}},client:{},organizeVoiceRecord:async()=> '테라리움 폴더에 저장했습니다.',refreshQuickVoiceBriefing:async()=>refreshes++,getFreshAccessToken:async()=> 'synthetic',reminderSessionEpoch:{capture:()=>()=>true},saveWorklog:async(token,text,options)=>{assert.equal(token,'synthetic');assert.equal(text,'Synthetic task');assert.equal(options.sourceType,'voice');saves++;return {dataCoreWorkRecordId:'saved',scheduleIds:[]};},synchronizeSavedScheduleReminders:async()=>[],savedReminderMessage:()=> 'Saved',setSavedReminder:value=>feedback=value};
  const tree=new Function('scope',`with(scope){${js}}`)(scope);
  if(screen==='settings'){assert.equal(tree,null);continue;}
  const card=nativeNodes(tree).find(n=>n.type==='VoiceRecorderCard');assert.equal(card.props.mode,'quick');
  const result=await card.props.quickVoice.saveWorklog('Synthetic task',{});await card.props.quickVoice.refreshBriefing();
  assert.match(result.reminderMessage,/테라리움 폴더/);assert.equal(result.recordId,'saved');assert.equal(feedback.target.recordId,'saved');assert.equal(saves,1);assert.equal(refreshes,1);
 }
});
test('pending voice in either tab prevents leaving that tab',()=>{
 const js=ts.transpileModule(`${navigate};return setScreen;`,{compilerOptions:{jsx:ts.JsxEmit.React}}).outputText;
 for(const screen of ['home','work']){
  let warned=0;const visits=[];const scope={screen,quickVoiceNavigation:{current:true},warnPendingVoice:()=>warned++,applyScreen:x=>visits.push(x)};
  const go=new Function('scope',`with(scope){${js}}`)(scope);
  go(screen==='home'?'work':'home');assert.equal(warned,1);assert.deepEqual(visits,[]);
  scope.quickVoiceNavigation.current=false;go('input');assert.deepEqual(visits,['input']);
 }
});
