import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const ts=createRequire(new URL('../mobile/package.json',import.meta.url))('typescript');
const parse=path=>ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const card=parse('mobile/src/features/voice/voice-recorder-card.tsx'),home=parse('mobile/app/index.tsx');
let top,callback,navigate;
function walk(n){
 if(ts.isJsxElement(n)&&n.openingElement.attributes.properties.some(p=>p.name?.getText(card)==='style'&&p.initializer?.getText(card)==='{styles.quickTopControl}'))top=n.getText(card);
 ts.forEachChild(n,walk);
}walk(card);
function visit(n){if(ts.isJsxAttribute(n)&&n.name.getText(home)==='onOpenMeetingRecording')callback=n.initializer.expression.getText(home);if(ts.isFunctionDeclaration(n)&&n.name?.text==='setScreen')navigate=n.getText(home);ts.forEachChild(n,visit);}visit(home);
function compile(code,scope){const js=ts.transpileModule(code,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS}}).outputText;return new Function('scope','with(scope){'+js+'}')(scope);}
const nodes=n=>Array.isArray(n)?n.flatMap(nodes):n&&typeof n==='object'?[n,...nodes(n.props?.children)]:[];
test('actual dock opens meeting only from idle and preserves recording, processing and saved feedback',()=>{
 assert.ok(top);let opened=0;
 const scope={React:{createElement:(type,props,...children)=>({type,props:{...props,children}})},View:'View',Text:'Text',Pressable:'Pressable',styles:{},quickPhase:'idle',inFlight:{current:false},onOpenMeetingRecording:()=>opened++,isRecording:false,statusDone:false,statusText:'대기'};
 const render=compile('return ()=>('+top+');',scope);
 let button=nodes(render()).find(n=>n.type==='Pressable');assert.equal(button.props.accessibilityLabel,'회의 녹음 열기');button.props.onPress();assert.equal(opened,1);
 scope.inFlight.current=true;button.props.onPress();assert.equal(opened,1);scope.inFlight.current=false;
 for(const phase of ['preparing','recording','transcribing','saving','saved','save_error']){scope.quickPhase=phase;scope.statusText=phase;assert.equal(nodes(render()).filter(n=>n.type==='Pressable').length,0);assert.ok(nodes(render()).some(n=>n.type==='Text'&&n.props.children.includes(phase)));}
});
test('meeting shortcut uses existing Home navigation and cannot bypass unfinished quick recording',()=>{
 assert.ok(callback&&navigate);let screen,warnings=0;
 const scope={quickVoiceNavigation:{current:false},warnPendingVoice:()=>warnings++,applyScreen:v=>screen=v};
 const open=compile(navigate+'; return '+callback+';',scope);open();assert.equal(screen,'meeting');scope.quickVoiceNavigation.current=true;screen='home';open();assert.equal(screen,'home');assert.equal(warnings,1);
});
