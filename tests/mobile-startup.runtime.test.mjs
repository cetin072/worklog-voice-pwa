import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { initialBriefingState } = await import('../mobile/src/features/startup/briefing-startup.ts');
const { withRequestDeadline } = await import('../mobile/src/platform/request-deadline.ts');
test('first response gates home, including empty/partial, while cached memory stays visible on refresh failure',()=>{
 assert.equal(initialBriefingState(false,''),'loading');
 assert.equal(initialBriefingState(false,'offline'),'error');
 assert.equal(initialBriefingState(true,''),'ready');
 assert.equal(initialBriefingState(true,'offline'),'ready');
});
test('a never-settling request times out and aborts; retry can succeed',async()=>{
 let signal;
 await assert.rejects(withRequestDeadline(s=>{signal=s;return new Promise(()=>{});},5),/연결이 지연/);
 assert.equal(signal.aborted,true);
 assert.deepEqual(await withRequestDeadline(async()=>({schedules:[]}),100),{schedules:[]});
});
test('offline failures preserve errors and a ready response has no artificial delay',async()=>{
 const offline=new Error('offline');await assert.rejects(withRequestDeadline(async()=>{throw offline;},100),e=>e===offline);
 let settled=false;const pending=withRequestDeadline(async()=>42,10000).then(n=>{settled=true;return n});
 assert.equal(await pending,42);assert.equal(settled,true);
});
const { notificationResponseHandler } = await import('../mobile/src/features/startup/notification-response-gate.ts');
test('late notification callback cannot consume a cold-start response after account remount',async()=>{
 let active=true,opens=0,clears=0;const response={scheduleId:'owned'};
 const old=notificationResponseHandler(()=>active,()=>{opens++;return true;},async()=>{clears++;});
 active=false;await old(response);assert.equal(opens,0);assert.equal(clears,0);
 const next=notificationResponseHandler(()=>true,()=>{opens++;return true;},async()=>{clears++;});
 await next(response);assert.equal(opens,1);assert.equal(clears,1);
});
test('unrecognized notification is not consumed',async()=>{
 let cleared=false;await notificationResponseHandler(()=>true,()=>false,async()=>{cleared=true;})({});assert.equal(cleared,false);
});
