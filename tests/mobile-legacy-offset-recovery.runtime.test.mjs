import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register('./helpers/mobile-ts-loader.mjs',import.meta.url);
const {createScheduleReminderService}=await import('../mobile/src/features/schedule/schedule-reminder-service.ts');
const {createLegacyOffsetRecovery}=await import('../mobile/src/features/schedule/legacy-offset-recovery.ts');
const {createReminderSyncEpoch}=await import('../mobile/src/features/schedule/schedule-reminder-snapshot.ts');
const {startupFixture,scope,STATE_KEY}=await import('./helpers/startup-reminder-fixture.mjs');
const S1='11111111-1111-4111-8111-111111111111',S2='22222222-2222-4222-8222-222222222222';
const date='2030-01-05T10:00:00.000Z';
const row=(id=S1,owner='A',extra={})=>({id,created_by_user_id:owner,title:'Current server title',starts_at:date,status:'confirmed',all_day:false,updated_at:'2030-01-01T00:00:00Z',...extra});
function client(rows,{owner='A',error=null,wait=async()=>{}}={}){
 return {
  auth:{getUser:async()=>({data:{user:{id:owner}},error:null})},
  from(table){
   assert.equal(table,'schedules');let ids;
   const query={
    select(_fields,options){assert.deepEqual(options,{count:'exact'});return query;},
    in(_key,values){ids=values;return query;},
    async eq(key,user){
     assert.equal(key,'created_by_user_id');assert.equal(user,owner);await wait();
     const data=rows.filter(r=>ids.includes(r.id)&&r.created_by_user_id===user);
     return{data,count:data.length,error};
    },
   };return query;
  },
 };
}
async function fixture(){
 const h=await startupFixture(createScheduleReminderService,{count:0});
 for(const sid of [S1,S2])for(const minutes of [30,1440])await h.service.scheduleReminder({scheduleId:sid,title:'Old private title',scheduleStartsAt:date,offsetMinutes:minutes});
 return h;
}
async function prepare(h,owner='A'){
 await h.service.prepareAccount(scope(owner));assert.equal(h.os.size,0);
 assert.deepEqual(await h.service.legacyOffsetCandidates(scope(owner)),[],'unverified candidate cannot be read');
 await h.service.confirmAccount(scope(owner),()=>true);
}
const recover=(h,c=client([row()]),current=()=>true,s=scope())=>createLegacyOffsetRecovery({candidates:h.service.legacyOffsetCandidates,restore:h.service.restoreLegacyOffsets})(c,s,current);
const saved=async(h,sid=S1)=>(await h.service.listScheduleReminders(sid)).map(r=>r.offsetMinutes);

test('legacy mixed accounts: cancel all first; restore only exact server-owned IDs and all their offsets with current title/time',async()=>{
 const h=await fixture();await prepare(h);const quarantine=JSON.parse(await h.storage.getItem(STATE_KEY)).legacyOffsets;
 assert.equal(JSON.stringify(quarantine).includes('Old private title'),false);
 const changed=row(S1,'A',{starts_at:'2030-01-06T12:00:00Z'});await recover(h,client([changed,row(S2,'B')]));
 assert.deepEqual(await saved(h),[30,1440]);assert.deepEqual(await saved(h,S2),[]);assert.equal(h.os.size,2);
 for(const r of h.os.values()){assert.equal(r.content.body,changed.title);assert.equal(r.content.data.triggerAt,new Date(Date.parse(changed.starts_at)-r.content.data.offsetMinutes*60000).toISOString());}
 assert.deepEqual(await h.service.legacyOffsetCandidates(scope()),[]);
});
test('wrong account first launch cannot restore or transfer hidden offsets to a later login',async()=>{
 const h=await fixture();await prepare(h,'B');await recover(h,client([row(),row(S2)],{owner:'B'}),()=>true,scope('B'));
 assert.equal(h.os.size,0);await h.service.prepareAccount(scope());await h.service.confirmAccount(scope(),()=>true);await recover(h);assert.equal(h.os.size,0);
});
test('another project, owner mismatch and stale server response never consume or restore a bound queue',async()=>{
 const h=await fixture();await prepare(h);let queries=0;
 await recover(h,client([row()],{wait:async()=>{queries++}}),()=>true,scope('A','https://other.invalid'));assert.equal(queries,0);
 await assert.rejects(recover(h,client([row(S1,'B')],{owner:'B'})),/OWNER_CHANGED/);assert.equal(h.os.size,0);
 const epoch=createReminderSyncEpoch(),current=epoch.capture();await assert.rejects(recover(h,client([row()],{wait:async()=>epoch.invalidate()}),current),/STALE/);
 assert.equal(h.os.size,0);assert.equal((await h.service.legacyOffsetCandidates(scope())).length,2);
});
test('offline query retains private candidates for same-scope restart/retry; explicit logout discards them',async()=>{
 const h=await fixture();await prepare(h);await assert.rejects(recover(h,client([],{error:{message:'offline'}})),/UNAVAILABLE/);assert.equal(h.os.size,0);
 h.service=h.restart();await h.service.prepareAccount(scope());await h.service.confirmAccount(scope(),()=>true);await recover(h);assert.deepEqual(await saved(h),[30,1440]);
 const logout=await fixture();await prepare(logout);await logout.service.clearForAccountExit();logout.service=logout.restart();await logout.service.prepareAccount(scope());await logout.service.confirmAccount(scope(),()=>true);await recover(logout);assert.equal(logout.os.size,0);
});
test('deleted, cancelled, completed, all-day or past canonical schedules are not restored',async()=>{
 for(const rows of [[],[row(S1,'A',{status:'cancelled'})],[row(S1,'A',{status:'completed'})],[row(S1,'A',{all_day:true})],[row(S1,'A',{starts_at:'2029-01-01T00:00:00Z'})]]){
  const h=await fixture();await prepare(h);await recover(h,client(rows));assert.equal(h.os.size,0);assert.deepEqual(await h.service.legacyOffsetCandidates(scope()),[]);
 }
});
test('changed time restores only offsets still in the future, never an immediate past-due alarm',async()=>{
 const h=await fixture();await prepare(h);await recover(h,client([row(S1,'A',{starts_at:'2030-01-01T01:00:00Z'})]));assert.deepEqual(await saved(h),[30]);
});
test('crash during initial cleanup retains candidates across restart without restoring before server verification',async()=>{
 for(const point of ['wrote','cancelled']){
  const h=await fixture();let once=true;h.fail(kind=>{if(kind===point&&once){once=false;throw Error('crash')}});
  await assert.rejects(h.service.prepareAccount(scope()),/crash/);h.fail(()=>{});h.service=h.restart();await prepare(h);await recover(h);assert.deepEqual(await saved(h),[30,1440]);assert.equal(h.os.size,2);
 }
});
test('partial restore + lost native acknowledgement survives restart without losing consumed offsets or duplicating reservations',async()=>{
 const h=await fixture();await prepare(h);const schedule=h.driver.schedule;let once=true;
 h.driver.schedule=async(item,sid)=>{const result=await schedule(item,sid);if(item.offsetMinutes===1440&&once){once=false;throw Error('lost ack')}return result;};
 await assert.rejects(recover(h),/lost ack/);assert.equal(h.os.size,2);
 h.service=h.restart();await h.service.prepareAccount(scope());assert.equal(h.os.size,0);await h.service.confirmAccount(scope(),()=>true);await recover(h);assert.deepEqual(await saved(h),[30,1440]);assert.equal(h.os.size,2);
 await recover(h);assert.equal(h.os.size,2);
});
test('cancelled offset and interrupted cancellation are never resurrected by migration',async()=>{
 const h=await fixture();h.fail(kind=>{if(kind==='cancel')throw Error('cancel failed')});await assert.rejects(h.service.cancelScheduleReminder(S1,30));h.fail(()=>{});
 await prepare(h);await recover(h);assert.deepEqual(await saved(h),[1440]);
 const pending=await fixture();await prepare(pending);await pending.service.cancelScheduleReminder(S1,30);pending.service=pending.restart();await pending.service.prepareAccount(scope());await recover(pending);assert.deepEqual(await saved(pending),[1440]);
});
test('cancel-all while canonical lookup is pending removes candidates before late response; restart cannot recreate them',async()=>{
 const h=await fixture();await prepare(h);await recover(h,client([row()],{wait:async()=>h.service.cancelAllScheduleReminders(S1)}));assert.equal(h.os.size,0);
 h.service=h.restart();await h.service.prepareAccount(scope());await recover(h);assert.equal(h.os.size,0);
});
test('known old-account state is never reclassified as unowned migration data',async()=>{
 const h=await fixture();await h.service.confirmAccount(scope('B'),()=>true);await h.service.prepareAccount(scope());await h.service.confirmAccount(scope(),()=>true);await recover(h);assert.equal(h.os.size,0);
});

test('failed initial server identity clears alarms but preserves bound private offsets for a verified retry',async()=>{
 const {createLocalAccountGate}=await import('../mobile/src/platform/local-account-gate.ts');
 const h=await fixture();let online=false,visible;
 const gate=createLocalAccountGate({
  clear:s=>h.service.prepareAccount(s?scope(s.user.id):null),
  reject:s=>h.service.clearUnverifiedAccount(scope(s.user.id)),
  confirm:(s,current)=>h.service.confirmAccount(scope(s.user.id),current),
  verify:async()=>{if(!online)throw Error('offline');return true;},owner(){},publish:s=>visible=s,failed(){},
 });
 const session={user:{id:'A'}};await gate.transition(session);assert.equal(visible,null);assert.equal(h.os.size,0);
 assert.deepEqual(await h.service.legacyOffsetCandidates(scope()),[]);
 h.service=h.restart();online=true;await gate.transition(session);assert.equal(visible,session);await recover(h);assert.deepEqual(await saved(h),[30,1440]);
});

test('permission denial retains candidates but never reports a reservation; retry does not prompt',async()=>{
 const h=await fixture();await prepare(h);let allowed=false;
 h.driver.permission=async request=>{assert.equal(request,false);return allowed;};
 await assert.rejects(recover(h),/권한/);assert.equal(h.os.size,0);
 allowed=true;await recover(h);assert.deepEqual(await saved(h),[30,1440]);
});

test('v2 custom-offset storage migrates through the existing durable reader and verified recovery',async()=>{
 const h=await fixture();const state=JSON.parse(await h.storage.getItem(STATE_KEY));
 await h.storage.updateItem('worklog.mobile.schedule-notifications.v2',()=>JSON.stringify(state.reminders));
 await h.storage.updateItem(STATE_KEY,()=>null);h.service=h.restart();await prepare(h);await recover(h);assert.deepEqual(await saved(h),[30,1440]);
});
