import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { createCalendarConnection } = await import('../mobile/src/features/calendar/calendar-connection.ts');

test('connection completion notifies the replacement screen; disconnect rejects late grants', async () => {
  let resolve;
  const target = {accountId:'synthetic',calendarId:'primary'};
  const grant = {target,email:'qa@example.invalid',expiresAt:Date.now()+60000,adapter:{target}};
  const service = createCalendarConnection({authorize:()=>new Promise(r=>resolve=r)});
  let oldUpdates=0,newUpdates=0;
  const unsubscribe=service.subscribe(()=>oldUpdates++);
  const connect=service.connect(); assert.equal(service.status().connecting,true);
  unsubscribe();service.subscribe(()=>newUpdates++);
  resolve(grant);await connect;
  assert.equal(oldUpdates,2);assert.equal(newUpdates,1);
  assert.equal(service.info().email,grant.email);assert.equal(service.status().connecting,false);
  const second=service.connect();service.disconnect();resolve(grant);
  assert.equal(await second,false);assert.equal(service.info(),null);
});

test('briefing metadata supplies explicit time to the existing immediate edit path', async () => {
  const {createWorklogDataCoreBriefingSource}=await import('../netlify/shared/worklog-data-core-briefing-source.mjs');
  const result=await createWorklogDataCoreBriefingSource({client:{rpc:async()=>({workspace_id:'synthetic',today:'2026-11-02',tasks:[
    {id:'a',title:'timed',status:'pending',due_at:'2026-11-02T01:30:00Z',metadata:{dueTimeExplicit:true}},
    {id:'b',title:'all day',status:'pending',due_at:'2026-11-02T00:00:00Z',metadata:{dueTimeExplicit:false}},
    {id:'c',title:'unknown',status:'pending',due_at:'2026-11-02T00:00:00Z',metadata:{}},
  ],schedules:[]})}}).load();
  const tasks=result.tasks;
  assert.equal(tasks.find(t=>t.pageId==='a').dueTime,'10:30');
  assert.equal(tasks.find(t=>t.pageId==='b').dueTime,'');
  assert.equal(tasks.find(t=>t.pageId==='c').dueTime,undefined);
});
