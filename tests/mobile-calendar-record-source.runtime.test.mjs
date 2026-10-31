import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const {readRecordCalendarSource}=await import('../mobile/src/features/calendar/calendar-record-source.ts');
const {createCalendarConnection}=await import('../mobile/src/features/calendar/calendar-connection.ts');
const {calendarExportEnd}=await import('../mobile/src/features/calendar/calendar-source.ts');
const id='44444444-4444-4444-8444-444444444444';
const sid='55555555-5555-4555-8555-555555555555';
function fixture() {
 const row={id,workspace_id:'w',created_by_user_id:'owner',title:'기한만 있는 업무',due_at:'2026-11-03T00:00:00+09:00',metadata:{dueTimeExplicit:false},updated_at:'2026-10-31T01:00:00Z',status:'in_progress'};
 let actor='owner',hasTime=false,linked=[];
 const client={auth:{getUser:async()=>({data:{user:{id:actor}}})},rpc:async()=>({data:[{record_id:id,title_value:row.title,due_at_value:row.due_at,due_has_time:hasTime}]}),from:table=>{
  const q={select:()=>q,eq:()=>q,single:async()=>({data:row}),or:async()=>({data:linked,count:linked.length})};return q;
 }};
 return {row,client,read:()=>readRecordCalendarSource(client,id,'owner',()=>true),actor:v=>actor=v,time:v=>hasTime=v,link:()=>linked=[{id:sid}]};
}
test('date-only and timed records export without creating or reserving a reminder',async()=>{
 const f=fixture();let posts=0,event=null;
 const source=await f.read();assert.equal(source.allDay,true);assert.equal(source.start,'2026-11-03');
 const target={accountId:'g',calendarId:'primary'};
 const connection=createCalendarConnection({authorize:async()=>({target,email:'synthetic@example.invalid',expiresAt:Date.now()+60000,adapter:{target,get:async()=>event,insert:async(eventId,draft)=>{posts++;return event={id:eventId,draft,status:'confirmed',sourceId:id};}}})});
 await connection.connect();assert.equal((await connection.send(source,calendarExportEnd(source),f.read,()=>true)).state,'confirmed');
 assert.equal((await connection.send(source,calendarExportEnd(source),f.read,()=>true)).alreadyExists,true);assert.equal(posts,1);
 f.row.due_at='2026-11-03T13:00:00+09:00';f.time(true);
 const timed=await f.read();assert.equal(timed.allDay,false);assert.equal(timed.start,f.row.due_at);
});
test('missing dates, wrong accounts and completed records never become exports',async()=>{
 const f=fixture();f.row.due_at=null;await assert.rejects(f.read,/CALENDAR_DATE_REQUIRED/);
 f.row.due_at='2026-11-03T13:00:00+09:00';f.actor('other');await assert.rejects(f.read,/OWNER_CHANGED/);
 f.actor('owner');f.row.status='completed';await assert.rejects(f.read,/UNAVAILABLE/);
});
test('a pre-existing schedule export is reconciled by GET and never duplicated',async()=>{
 const f=fixture();f.link();const source=await f.read();let posts=0;
 const target={accountId:'g',calendarId:'primary'};
 const connection=createCalendarConnection({authorize:async()=>({target,email:'synthetic@example.invalid',expiresAt:Date.now()+60000,adapter:{target,get:async eventId=>({id:eventId,status:'confirmed',sourceId:sid,draft:{...source,scheduleId:sid,end:calendarExportEnd(source)}}),insert:async()=>{posts++;}}})});
 await connection.connect();const result=await connection.send(source,calendarExportEnd(source),f.read,()=>true);
 assert.equal(result.state,'confirmed');assert.equal(result.alreadyExists,true);assert.equal(posts,0);
});
