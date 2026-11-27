import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {nativeNodes,nativeWords} from './helpers/native-component-harness.mjs';
const ts=createRequire(new URL('../mobile/package.json',import.meta.url))('typescript');
const source=readFileSync('mobile/app/index.tsx','utf8');
const ast=ts.createSourceFile('home.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let tabs, dock, navigate;
const tabDefinitions = [];
function walk(node){if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(decl=>['primaryTabs','taejangTab'].includes(decl.name.getText(ast))))tabDefinitions.push(node.getText(ast));if(ts.isConditionalExpression(node)&&ts.isJsxElement(node.whenTrue)&&node.whenTrue.openingElement.getText(ast).includes('styles.quickVoiceFooter'))dock=node.getText(ast);if(ts.isFunctionDeclaration(node)&&node.name?.text==='setScreen')navigate=node.getText(ast);if(ts.isJsxElement(node)&&node.openingElement.getText(ast).includes('styles.bottomTabs'))tabs=node.getText(ast);ts.forEachChild(node,walk);}
walk(ast);
test('actual bottom navigation preserves Home/Work and adds Taejang only with verified access',()=>{
 assert.ok(tabs);
 assert.equal(tabDefinitions.length,2);
 const js=ts.transpileModule(`${tabDefinitions.join('\n')}\nreturn (${tabs});`,{compilerOptions:{jsx:ts.JsxEmit.React}}).outputText;
 for (const canOpenTaejang of [false,true]) {
  const visited=[];
  const scope={React:{createElement:(type,props,...children)=>({type,props:{...props,children}})},View:'View',Text:'Text',Pressable:'Pressable',styles:{},screen:canOpenTaejang?'taejang':'work',insets:{bottom:20},canOpenTaejang,setScreen:screen=>visited.push(screen)};
  const tree=new Function('scope',`with(scope){${js}}`)(scope);
  const buttons=nativeNodes(tree).filter(n=>n.props?.accessibilityRole==='tab');
  assert.deepEqual(buttons.map(n=>nativeWords(n).trim()),canOpenTaejang?['홈','업무','태장']:['홈','업무']);
  assert.deepEqual(buttons.filter(n=>n.props.accessibilityState.selected).map(n=>n.props.accessibilityLabel),[canOpenTaejang?'태장':'업무']);
  buttons.forEach(n=>n.props.onPress());
  assert.deepEqual(visited,canOpenTaejang?['home','work','taejang']:['home','work']);
  assert.equal(tree.props.style[1].paddingBottom,20);
 }
 assert.match(source,/bottomTabs: \{ flexShrink: 0/);
 assert.match(source,/paddingBottom: screen === 'home' \? QUICK_VOICE_LAYOUT\.dockReserveHeight \+ 32 : 16/);
 assert.match(source,/onOpenManagement=\{\(\)=>\{setManagementReturn\('home'\);setScreen\('subscriptions'\);\}\}/);
});

test('both tabs share voice saves, with a dedicated non-overlay input footer on Work',async()=>{
 assert.ok(dock);
 const js=ts.transpileModule(`return (${dock});`,{compilerOptions:{jsx:ts.JsxEmit.React}}).outputText;
 for(const screen of ['home','work','settings','taejang']){
  let saves=0,refreshes=0,feedback;
  const styles={quickVoiceFooter:{position:'absolute'},workInputFooter:{flexShrink:0}};
  const scope={React:{createElement:(type,props,...children)=>({type,props:{...props,children}})},View:'View',VoiceRecorderCard:'VoiceRecorderCard',CaptureImportButton:'CaptureImportButton',styles,insets:{bottom:20},screen,showQuickVoice:screen==='home'||screen==='work',androidTouchSmoke:false,FORCE_WHISPER_FALLBACK_QA_MODE:false,prepareQuickVoiceWhisperProvider:()=>{},QUICK_VOICE_SPEECH_RECOGNITION:{},quickVoiceNavigation:{current:false},session:{user:{id:'owner'}},client:{},organizeVoiceRecord:async()=> '테라리움 폴더에 저장했습니다.',refreshQuickVoiceBriefing:async()=>refreshes++,getFreshAccessToken:async()=> 'synthetic',reminderSessionEpoch:{capture:()=>()=>true},saveWorklog:async(token,text,options)=>{assert.equal(token,'synthetic');assert.equal(text,'Synthetic task');assert.equal(options.sourceType,'voice');saves++;return {dataCoreWorkRecordId:'saved',scheduleIds:[]};},synchronizeSavedScheduleReminders:async()=>[],savedReminderMessage:()=> 'Saved',setSavedReminder:value=>feedback=value};
  const tree=new Function('scope',`with(scope){${js}}`)(scope);
  if(screen==='settings'||screen==='taejang'){assert.equal(tree,null);continue;}
  const card=nativeNodes(tree).find(n=>n.type==='VoiceRecorderCard');assert.equal(card.props.mode,'quick');
  assert.equal(tree.props.style,screen==='work'?styles.workInputFooter:styles.quickVoiceFooter);
  assert.equal(card.props.embedded,screen==='work');
  assert.equal(card.props.renderPhotoAction(false).props.label,screen==='work'?'사진 가져오기':undefined);
  const result=await card.props.quickVoice.saveWorklog('Synthetic task',{});await card.props.quickVoice.refreshBriefing();
  assert.match(result.reminderMessage,/테라리움 폴더/);assert.equal(result.recordId,'saved');assert.equal(feedback.target.recordId,'saved');assert.equal(saves,1);assert.equal(refreshes,1);
 }
});
test('pending voice in either tab prevents leaving that tab',()=>{
 const js=ts.transpileModule(`${navigate};return setScreen;`,{compilerOptions:{jsx:ts.JsxEmit.React}}).outputText;
 for(const screen of ['home','work']){
  let warned=0;const visits=[];const scope={screen,canOpenTaejang:true,quickVoiceNavigation:{current:true},warnPendingVoice:()=>warned++,applyScreen:x=>visits.push(x)};
  const go=new Function('scope',`with(scope){${js}}`)(scope);
  go(screen==='home'?'work':'home');assert.equal(warned,1);assert.deepEqual(visits,[]);
  scope.quickVoiceNavigation.current=false;go('input');assert.deepEqual(visits,['input']);
  scope.quickVoiceNavigation.current=true;go('taejang');assert.equal(warned,2);assert.deepEqual(visits,['input']);
  scope.quickVoiceNavigation.current=false;scope.canOpenTaejang=false;go('taejang');assert.deepEqual(visits,['input']);
  scope.canOpenTaejang=true;go('taejang');assert.deepEqual(visits,['input','taejang']);
 }
});
