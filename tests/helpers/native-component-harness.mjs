import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const ts=createRequire(new URL('../../mobile/package.json',import.meta.url))('typescript');
/** Executes production TSX and handlers; native host nodes are inspected without claiming device execution. */
export function nativeComponentHarness(file,name,imports={},seed=[]) {
 const states=[],refs=[],callbacks=[],effects=[];let si=0,ri=0,ci=0,ei=0;const pending=[];
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),useState(initial){const i=si++;if(!(i in states))states[i]=i in seed?seed[i]:typeof initial==='function'?initial():initial;return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value}];},useRef(initial){const i=ri++;return refs[i]||=( {current:initial});},useCallback(fn,deps){const i=ci++;if(!same(callbacks[i]?.deps,deps))callbacks[i]={deps,fn};return callbacks[i].fn;},useMemo(fn){return fn()},useEffect(fn,deps){const i=ei++;if(!same(effects[i]?.deps,deps)){effects[i]?.cleanup?.();effects[i]={deps};pending.push(()=>{effects[i].cleanup=fn();});}}};
 const native={View:'View',Text:'Text',TextInput:'TextInput',Pressable:'Pressable',Platform:{OS:'android'},StyleSheet:{create:s=>s},AppState:{addEventListener:()=>({remove(){}})},Alert:{alert(){}}};
 const exp={};const js=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS}}).outputText;
 new Function('React','require','exports',js)(React,n=>n==='react'?React:n==='react-native'?native:imports[n]??(()=>{throw Error('Missing boundary '+n)})(),exp);
 return {call(...args){si=ri=ci=ei=0;return exp[name](...args)},render(props={}){si=ri=ci=ei=0;return exp[name](props)},async effects(){pending.splice(0).forEach(fn=>fn());await new Promise(r=>setImmediate(r));},close(){effects.forEach(e=>e.cleanup?.());},states};
}
export const nativeNodes=tree=>Array.isArray(tree)?tree.flatMap(nativeNodes):tree&&typeof tree==='object'?[tree,...nativeNodes(tree.props?.children)]:[];
export const nativeWords=tree=>Array.isArray(tree)?tree.map(nativeWords).join(' '):tree&&typeof tree==='object'?nativeWords(tree.props?.children):String(tree??'');
