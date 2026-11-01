import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const ts=createRequire(new URL('../mobile/package.json',import.meta.url))('typescript');
const tick=()=>new Promise(r=>setImmediate(r));
function harness({disabled=false,cancel=false,compact=true}={}) {
 const pushes=[],calls=[],effects=[];let finish;
 const modules={
  react:{useEffect:fn=>effects.push(fn()),useRef:value=>({current:value}),useState:value=>[value,()=>{}]},
  'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
  'react-native':{Platform:{OS:'android'},Alert:{alert:()=>{}},Pressable:'Pressable',Text:'Text',View:'View',StyleSheet:{create:x=>x}},
  'expo-router':{useRouter:()=>({push:x=>pushes.push(x)})},
  '@/src/providers/platform-provider':{usePlatform:()=>({session:{user:{id:'alice'}}})},
  './capture-gallery':{importCaptureFromGallery:async(owner,current,open)=>{calls.push(owner);await new Promise(r=>finish=r);if(!cancel&&current())open('a'.repeat(64));}},
 };
 const exports={};const code=ts.transpileModule(readFileSync('mobile/src/features/capture/capture-import-button.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{exports,require:n=>{assert.ok(modules[n],n);return modules[n];}});
 const tree=exports.CaptureImportButton({compact,disabled});
 return {tree,pushes,calls,finish:()=>finish?.(),unmount:()=>effects.forEach(x=>x?.())};
}
test('photo shortcut reuses one gallery import and opens the normal capture route',async()=>{
 const h=harness();assert.equal(h.tree.props.accessibilityLabel,'사진 · 캡처 가져오기');
 assert.ok(h.tree.props.children.some(x=>x.props.children==='사진 등록'));
 h.tree.props.onPress();h.tree.props.onPress();assert.equal(h.calls.length,1);
 h.finish();await tick();assert.equal(h.pushes.length,1);assert.equal(h.pushes[0].pathname,'/capture');
});
test('home photo entry explains sharing and reuses the same gallery import',async()=>{
 const h=harness({compact:false});const button=h.tree.props.children[0];
 assert.equal(button.props.accessibilityLabel,'사진 가져오기');
 assert.match(JSON.stringify(h.tree),/사진 → 공유 → 업무수첩/);
 button.props.onPress();assert.equal(h.calls.length,1);
 h.finish();await tick();assert.equal(h.pushes[0].pathname,'/capture');
 const blocked=harness({compact:false,disabled:true});
 assert.equal(blocked.tree.props.children[0].props.disabled,true);
 blocked.tree.props.children[0].props.onPress();assert.equal(blocked.calls.length,0);
});
test('recording disables photos; picker cancel or leaving the screen cannot navigate',async()=>{
 const blocked=harness({disabled:true});assert.equal(blocked.tree.props.disabled,true);blocked.tree.props.onPress();assert.equal(blocked.calls.length,0);
 const cancelled=harness({cancel:true});cancelled.tree.props.onPress();cancelled.finish();await tick();assert.equal(cancelled.pushes.length,0);
 const left=harness();left.tree.props.onPress();left.unmount();left.finish();await tick();assert.equal(left.pushes.length,0);
});
