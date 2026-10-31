import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, register } from 'node:module';
import vm from 'node:vm';
register('./helpers/mobile-ts-loader.mjs',import.meta.url);
const {createCaptureInbox}=await import('../mobile/src/features/capture/capture-inbox.ts');
const ts=createRequire(new URL('../mobile/package.json',import.meta.url))('typescript');
function load(file,modules) {
 const exports={};const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,URL,require:n=>{assert.ok(n in modules,n);return modules[n];}});return exports;
}
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};
function harness(actor='alice') {
 const values=[],routes=[],clears=[],data=new Map();let cursor=0,cleanup=null,effect,link,active,raw=[],copy=null;
 const inbox=createCaptureInbox({getItem:async k=>data.get(k)||null,setItem:async(k,v)=>data.set(k,v)});
 const share=load('mobile/src/features/capture/capture-share-gate.tsx',{
  react:{useRef:v=>{const i=cursor++;return values[i]||=( {current:v} );},useEffect:fn=>effect=fn},
  'react-native':{Platform:{OS:'android'},AppState:{addEventListener:(_e,fn)=>{active=fn;return{remove(){}};}},Linking:{addEventListener:(_e,fn)=>{link=fn;return{remove(){}};}}},
  'expo-router':{usePathname:()=> '/',useRouter:()=>({push:x=>routes.push(x),replace:x=>routes.push(x)})},
  'expo-sharing':{getSharedPayloads:()=>raw,clearSharedPayloads:()=>{clears.push(raw[0]?.value);raw=[];}},
  '@/src/providers/platform-provider':{usePlatform:()=>({session:actor?{user:{id:actor}}:null})},
  './capture-runtime':{captureInbox:inbox},
  './capture-files':{importCaptureImage:async uri=>copy?copy(uri):{hash:(uri.endsWith('b')?'b':'a').repeat(64),uri:'file:///private/'+uri.at(-1)},removeCaptureImage:async()=>{}},
 });
 const render=()=>{if(cleanup)cleanup();cursor=0;share.CaptureShareGate();cleanup=effect();};
 return{render,routes,clears,inbox,setRaw:uri=>raw=[{value:uri,mimeType:'image/png',shareType:'image'}],url:()=>link({url:'worklog-qa://expo-sharing'}),activate:()=>active('active'),defer:fn=>copy=fn,setActor:value=>actor=value};
}
test('cold share is retained before login and warm URL shares work without AppState changes',async()=>{
 const h=harness(null);h.setRaw('content://gallery/a');h.render();await settle();
 assert.equal((await h.inbox.pending(null)).hash,'a'.repeat(64));assert.equal(h.routes.at(-1).params.hash,'a'.repeat(64));
 h.setActor('alice');h.render();await settle();h.setRaw('content://gallery/b');h.url();await settle();
 assert.equal((await h.inbox.get('b'.repeat(64),'alice')).owner,'alice');assert.equal(h.clears.length,2);
});
test('a newer warm intent is queued and never cleared by an earlier copy',async()=>{
 const h=harness();let release;h.defer(uri=>uri.endsWith('a')?new Promise(r=>release=()=>r({hash:'a'.repeat(64),uri:'file:///private/a'})):Promise.resolve({hash:'b'.repeat(64),uri:'file:///private/b'}));
 h.setRaw('content://gallery/a');h.render();await settle();h.setRaw('content://gallery/b');h.url();release();await settle();
 assert.deepEqual(h.clears,['content://gallery/b']);assert.ok(await h.inbox.get('a'.repeat(64),'alice'));assert.ok(await h.inbox.get('b'.repeat(64),'alice'));
});
test('account transition during import never exposes the prior account capture',async()=>{
 const h=harness();let release;h.defer(()=>new Promise(r=>release=()=>r({hash:'a'.repeat(64),uri:'file:///private/a'})));
 h.setRaw('content://gallery/a');h.render();await settle();h.setActor('bob');h.render();release();await settle();
 assert.ok(await h.inbox.get('a'.repeat(64),'alice'));assert.equal(await h.inbox.get('a'.repeat(64),'bob'),null);assert.equal(h.routes.length,0);
});
test('incoming URI policy rejects remote URLs and app-private paths and own providers',()=>{
 const {incomingCaptureUri}=load('mobile/src/features/capture/capture-files.ts',{'expo-constants':{__esModule:true,default:{expoConfig:{android:{package:'com.cetin072.worklog.qa'}}}},'react-native':{},'expo-file-system/legacy':{documentDirectory:'file:///private/'},'expo-file-system':{},'expo-crypto':{}});
 assert.equal(incomingCaptureUri('content://com.kakao.talk/images/1'),true);
 assert.equal(incomingCaptureUri('file:///storage/emulated/0/Pictures/capture.png'),true);
 for(const uri of ['https://example.com/image.png','file:///data/user/0/com.cetin072.worklog.qa/files/auth','content://com.cetin072.worklog.qa.SharingFileProvider/secret','file:///storage/../../data/user/secret'])assert.equal(incomingCaptureUri(uri),false,uri);
});
test('native intent redirect preserves OAuth and notification paths exactly',()=>{
 const {redirectSystemPath}=load('mobile/app/+native-intent.ts',{});
 for(const path of ['worklog://auth/callback?code=synthetic','worklog-qa://auth/callback?code=synthetic','/?scheduleId=synthetic','/'])assert.equal(redirectSystemPath({path,initial:true}),path);
 assert.equal(redirectSystemPath({path:'worklog-qa://expo-sharing',initial:false}),'/capture');
});
