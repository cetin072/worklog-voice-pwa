import test from 'node:test';import assert from 'node:assert/strict';
import {createLocalAccountGate} from '../mobile/src/platform/local-account-gate.ts';
const A={user:{id:'account-a'}},B={user:{id:'account-b'}};
const wait=()=>new Promise(r=>setTimeout(r,5));
test('startup, OAuth A→B and logout publish only after cleanup + server verification',async()=>{
 const calls=[];let owner,visible;
 const gate=createLocalAccountGate({clear:async()=>calls.push('cleanup'),verify:async id=>{calls.push('verify:'+id);return true;},owner:v=>{owner=v;},publish:v=>{visible=v;},failed:()=>assert.fail('unexpected')});
 const pending=gate.transition(A);assert.equal(owner,null);assert.equal(visible,null);await pending;assert.equal(visible,A);
 const next=gate.transition(B);assert.equal(owner,null);assert.equal(visible,null);await next;
 assert.equal(owner,'account-b');assert.equal(visible,B);assert.deepEqual(calls,['cleanup','verify:account-a','cleanup','verify:account-b']);
 await gate.transition(null);assert.equal(visible,null);assert.equal(owner,null);
});
test('cleanup cancellation failure blocks new account, next transition safely retries',async()=>{
 let fail=true,visible=null;const gate=createLocalAccountGate({clear:async()=>{if(fail)throw Error('native cancel');},verify:async()=>true,owner(){},publish:v=>visible=v,failed(){}});
 await gate.transition(B);assert.equal(visible,null);fail=false;await gate.transition(B);assert.equal(visible,B);
});
test('late A verification and disposed callbacks cannot reveal old account',async()=>{
 let release,visible=null;const gate=createLocalAccountGate({clear:async()=>{},verify:id=>id==='account-a'?new Promise(r=>release=r):Promise.resolve(true),owner(){},publish:v=>visible=v,failed(){}});
 const old=gate.transition(A);await wait();await gate.transition(B);release(true);await old;assert.equal(visible,B);
 gate.dispose();await wait();assert.equal(gate.current(),null);
});
test('server identity mismatch never grants local recording access',async()=>{
 let owner,failed=false;const gate=createLocalAccountGate({clear:async()=>{},verify:async()=>false,owner:v=>owner=v,publish(){},failed(){failed=true;}});
 await gate.transition(A);assert.equal(owner,null);assert.equal(failed,true);
});
