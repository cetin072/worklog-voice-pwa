import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./helpers/mobile-ts-loader.mjs',import.meta.url);
const {createScheduleReminderService}=await import('../mobile/src/features/schedule/schedule-reminder-service.ts');
const {createLocalAccountGate}=await import('../mobile/src/platform/local-account-gate.ts');
const {withRequestDeadline}=await import('../mobile/src/platform/request-deadline.ts');
const {measureStartup}=await import('../mobile/src/features/startup/startup-timing.ts');
const {startupFixture,scope,STATE_KEY,delay}=await import('./helpers/startup-reminder-fixture.mjs');
const A={user:{id:'A'}},B={user:{id:'B'}};
function gate(h,verify=async()=>true){let visible,failed=0;const g=createLocalAccountGate({
 clear:s=>h.service.prepareAccount(s?scope(s.user.id):null),verify,
 confirm:(s,current)=>h.service.confirmAccount(scope(s.user.id),current),owner(){},publish:s=>visible=s,failed(){failed++;},
 });return {g,get visible(){return visible},get failed(){return failed}};}
test('same-project/account durable proof survives restart with every custom offset and zero OS mutation',async()=>{
 const h=await startupFixture(createScheduleReminderService,{accountScope:scope()});const before=structuredClone([...h.os.values()]);
 h.service=h.restart();const g=gate(h);await g.g.transition(A);
 assert.equal(g.visible,A);assert.deepEqual([...h.os.values()],before);assert.equal(h.counts.cancel,0);assert.equal(h.counts.schedule,0);assert.equal(h.counts.list,1);
});
test('absent proof, different account and different project all require full cleanup',async()=>{
 for(const accountScope of [undefined,scope('B'),scope('A','https://other.invalid')]){
  const h=await startupFixture(createScheduleReminderService,{accountScope});const g=gate(h);await g.g.transition(A);
  assert.equal(g.visible,A);assert.equal(h.os.size,0);assert.equal(h.counts.cancel,12);assert.equal(h.counts.list,2);
 }
});
test('offline/mismatch clears retained alarms and blocks access; retry verifies again',async()=>{
 for(const verify of [async()=>false,async()=>{throw Error('offline')}]){
  const h=await startupFixture(createScheduleReminderService,{accountScope:scope()});const g=gate(h,verify);await g.g.transition(A);
  assert.equal(g.visible,null);assert.equal(g.failed,1);assert.equal(h.os.size,0);
  const retry=gate(h);await retry.g.transition(A);assert.equal(retry.visible,A);
 }
});
test('identity timeout cannot publish late success and a retry is usable',async()=>{
 const h=await startupFixture(createScheduleReminderService,{accountScope:scope()});let resolve;
 const g=gate(h,()=>withRequestDeadline(()=>new Promise(r=>resolve=r),5));await g.g.transition(A);
 assert.equal(g.visible,null);resolve(true);await delay(1);assert.equal(g.visible,null);assert.equal(h.os.size,0);
 const retry=gate(h);await retry.g.transition(B);assert.equal(retry.visible,B);
});
test('crash after cancellation or journal acknowledgement leaves restart-safe cleanup evidence',async()=>{
 for(const point of ['wrote','cancelled']){
  const h=await startupFixture(createScheduleReminderService,{accountScope:scope()});let once=true;
  h.fail(kind=>{if(kind===point&&once){once=false;throw Error('synthetic crash')}});
  await assert.rejects(h.service.prepareAccount(scope('B')),/synthetic crash/);
  h.fail(()=>{});h.service=h.restart();await h.service.prepareAccount(scope('B'));
  assert.equal(h.os.size,0);const state=JSON.parse(await h.storage.getItem(STATE_KEY));
  assert.equal(state.accountScope,undefined);assert.deepEqual(state.legacyCleanup,{});
 }
});
test('cancellation rejection blocks publication, durable retry succeeds',async()=>{
 const h=await startupFixture(createScheduleReminderService,{accountScope:scope()});h.fail(kind=>{if(kind==='cancel')throw Error('native offline')});
 const g=gate(h);await g.g.transition(B);assert.equal(g.visible,null);assert.equal(h.os.size,12);
 assert.equal(JSON.parse(await h.storage.getItem(STATE_KEY)).accountScope,undefined);
 h.fail(()=>{});await g.g.transition(B);assert.equal(g.visible,B);assert.equal(h.os.size,0);
});
test('late old verification and stale confirmation cannot replace a newer account or logout',async()=>{
 const h=await startupFixture(createScheduleReminderService,{accountScope:scope()});let release;
 const g=gate(h,id=>id==='A'?new Promise(r=>release=r):Promise.resolve(true));
 const old=g.g.transition(A);await delay(5);await g.g.transition(B);release(true);await old;
 assert.equal(g.visible,B);assert.equal(JSON.parse(await h.storage.getItem(STATE_KEY)).accountScope,scope('B'));
 await g.g.transition(null);assert.equal(g.visible,null);assert.equal(JSON.parse(await h.storage.getItem(STATE_KEY)).accountScope,undefined);
 await assert.rejects(h.service.confirmAccount(scope(),()=>false));
});
test('orphan or wrong metadata invalidates same-account proof; foreign notifications are preserved',async()=>{
 const h=await startupFixture(createScheduleReminderService,{accountScope:scope()});
 const first=[...h.os.values()][0];h.os.set('worklog.reminder.v3.orphan',{...structuredClone(first),identifier:'worklog.reminder.v3.orphan'});
 h.os.set('foreign',{identifier:'foreign',content:{data:{owner:'foreign'}}});await h.service.prepareAccount(scope());
 assert.deepEqual([...h.os.keys()],['foreign']);
 const bad=await startupFixture(createScheduleReminderService,{accountScope:scope()});[...bad.os.values()][0].content.data.scheduleId='wrong';
 await assert.rejects(bad.service.prepareAccount(scope()),/OWNERSHIP_MISMATCH/);assert.equal(bad.os.size,12);
});
test('privacy-safe timing records only fixed stage, duration and outcome, and never changes failures',async()=>{
 const events=[];let time=10;await measureStartup('config',async()=>{time=25;return 'secret'},e=>events.push(e),()=>time);
 const error=Error('private token');await assert.rejects(measureStartup('identity',async()=>{throw error},e=>events.push(e),()=>time),e=>e===error);
 assert.deepEqual(events,[{stage:'config',durationMs:15,outcome:'ok'},{stage:'identity',durationMs:0,outcome:'error'}]);
 assert.equal(await measureStartup('briefing',async()=>42,()=>{throw Error('sink')}),42);
});

test('native cancellation without removal is not success',async()=>{
 const h=await startupFixture(createScheduleReminderService,{accountScope:scope()});h.driver.cancel=async()=>{};
 const g=gate(h);await g.g.transition(B);assert.equal(g.visible,null);assert.equal(h.os.size,12);
 assert.equal(JSON.parse(await h.storage.getItem(STATE_KEY)).accountScope,undefined);
});
