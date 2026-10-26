import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const requireMobile=createRequire(new URL('../mobile/package.json',import.meta.url));
const ts=requireMobile('typescript');
const source=readFileSync(new URL('../mobile/src/features/startup/startup-screen.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function harness(){
 let states=[],effects=[],cursor=0,ec=0,timers=new Set();
 const react={useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useEffect(effect,deps){const i=ec++;const old=effects[i];if(!old||deps.some((v,j)=>v!==old.deps[j])){old?.cleanup?.();effects[i]={deps,cleanup:effect()};}}};
 const module={exports:{}};
 new Function('require','exports','setTimeout','clearTimeout',compiled)(name=>name==='react'?react:name==='react-native'?{View:'View',Text:'Text',Button:'Button',ActivityIndicator:'Spinner',StyleSheet:{create:x=>x}}:requireMobile(name),module.exports,fn=>{timers.add(fn);return fn;},fn=>timers.delete(fn));
 return {render(props={}){cursor=0;ec=0;return module.exports.StartupScreen(props);},expire(){for(const fn of [...timers]){timers.delete(fn);fn();}},get pending(){return timers.size;}};
}
function flatten(node){return !node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(flatten)];}
test('slow restore shows retry, retry resets spinner and watchdog without an artificial minimum wait',()=>{
 const h=harness();let retries=0;const props={onRetry:()=>retries++};
 assert.ok(flatten(h.render(props)).some(n=>n.type==='Spinner'));
 h.expire();let tree=h.render(props);assert.ok(flatten(tree).some(n=>n.props?.title==='다시 시도'));
 flatten(tree).find(n=>n.props?.title==='다시 시도').props.onPress();
 tree=h.render(props);assert.equal(retries,1);assert.ok(flatten(tree).some(n=>n.type==='Spinner'));assert.equal(h.pending,1);
});
test('failure has retry and logout, never a spinner; initial screen does not fabricate empty schedules',()=>{
 const h=harness();const tree=h.render({error:'offline',onRetry(){},onSignOut(){}});const nodes=flatten(tree);
 assert.ok(nodes.some(n=>n.props?.title==='다시 시도'));assert.ok(nodes.some(n=>n.props?.title==='로그아웃'));assert.equal(nodes.some(n=>n.type==='Spinner'),false);
});
