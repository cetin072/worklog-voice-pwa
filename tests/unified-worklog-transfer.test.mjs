import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
import {remapWorklogRows,AUTH_COLUMNS,transferCounts} from '../scripts/consolidation/remap-worklog-rows.mjs';
const old='11111111-1111-4111-8111-111111111111',erp='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333',space='44444444-4444-4444-8444-444444444444',record='55555555-5555-4555-8555-555555555555',schedule='66666666-6666-4666-8666-666666666666';
function data(){const x=Object.fromEntries(Object.keys(AUTH_COLUMNS).map(t=>[t,[]]));x.workspaces=[{id:space,name:'합성 개인 공간',kind:'personal',owner_user_id:old,created_by_user_id:old}];x.workspace_members=[{workspace_id:space,user_id:old,role:'owner'}];x.work_records=[{id:record,workspace_id:space,created_by_user_id:old,assigned_user_id:null,title:'합성 업무',content:'보존할 원문 '+old,original_text:'원문',journal_date:'2026-11-02',action_kind:'task'}];x.schedules=[{id:schedule,workspace_id:space,created_by_user_id:old,title:'합성 모바일 일정',starts_at:'2026-11-02T01:00:00Z',metadata:{workRecordId:record,originalUserMention:old}}];return x;}
test('offline transfer remaps Auth references only; IDs, text, metadata and source are preserved',()=>{const source=data(),before=structuredClone(source),out=remapWorklogRows(source,{[old]:erp});assert.deepEqual(source,before);assert.equal(out.workspaces[0].owner_user_id,erp);assert.equal(out.work_records[0].created_by_user_id,erp);assert.equal(out.schedules[0].id,schedule);assert.equal(out.schedules[0].metadata.originalUserMention,old);assert.equal(out.work_records[0].content,source.work_records[0].content);assert.deepEqual(transferCounts(out),transferCounts(source));});
test('incomplete exports, unknown tables and unmapped users block transfer',()=>{assert.throws(()=>remapWorklogRows({}, {[old]:erp}),/INCOMPLETE_EXPORT/);assert.throws(()=>remapWorklogRows({...data(),auth_users:[]},{[old]:erp}),/UNKNOWN_TABLE/);assert.throws(()=>remapWorklogRows(data(),{[other]:erp}),/UNMAPPED_AUTH_USER/);});
test('automatic many-to-one account merges and personal workspace collisions are forbidden',()=>{assert.throws(()=>remapWorklogRows(data(),{[old]:erp,[other]:erp}),/AMBIGUOUS/);const x=data();x.workspaces.push({...x.workspaces[0],id:record});assert.throws(()=>remapWorklogRows(x,{[old]:erp}),/PERSONAL_WORKSPACE_COLLISION/);});
test('push registrations are retained disabled; delivery history is not reset',()=>{const x=data();x.push_subscriptions=[{id:'synthetic',user_id:old,disabled_at:null}];x.notification_deliveries=[{id:'delivery',user_id:old,status:'sent'}];const out=remapWorklogRows(x,{[old]:erp});assert.ok(out.push_subscriptions[0].disabled_at);assert.equal(out.notification_deliveries[0].status,'sent');assert.equal(x.push_subscriptions[0].disabled_at,null);});
test('real PostgreSQL engine replays 14-table catalog; remapped owner reads, another employee and anon cannot',async()=>{
 const db=new PGlite({extensions:{pg_trgm}});
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create extension pg_trgm;create table public.notification_deliveries(id text primary key,status text);insert into public.notification_deliveries values('ERP-existing','unchanged');`);
  try { await db.exec(await readFile(new URL('../supabase/rehearsal/unified-worklog-catalog.sql',import.meta.url),'utf8')); } catch(e) { throw new Error('REHEARSAL_SCHEMA: '+e.message); }
  const names=await db.query("select tablename,rowsecurity from pg_tables where schemaname='worklog'");assert.equal(names.rows.length,14);assert.ok(names.rows.every(t=>t.rowsecurity));
  await db.query('insert into auth.users values($1),($2)',[erp,other]);
  const mapped=remapWorklogRows(data(),{[old]:erp});
  await db.transaction(async tx=>{
   for(const table of ['workspaces','workspace_members','work_records','schedules'])for(const row of mapped[table]){
    const columns=Object.keys(row);await tx.query(`insert into worklog.${table}(${columns.map(x=>'"'+x+'"').join(',')}) values(${columns.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));
   }
  });
  const readAs=async(uid,sql)=>{await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${uid}',false)`);try{return await db.query(sql);}finally{await db.exec('reset role');}};
  assert.equal((await readAs(erp,'select title from worklog.schedules')).rows[0].title,'합성 모바일 일정');assert.equal((await readAs(erp,'select id from worklog.work_records')).rows[0].id,record);
  assert.equal((await readAs(other,'select * from worklog.schedules')).rows.length,0);assert.equal((await readAs(other,'select * from worklog.work_records')).rows.length,0);
  await db.exec('set role anon');await assert.rejects(db.query('select * from worklog.schedules'),/permission denied/);await db.exec('reset role');
  assert.deepEqual((await db.query('select * from public.notification_deliveries')).rows,[{id:'ERP-existing',status:'unchanged'}]);
  // A failed FK transfer is atomic and preserves previously copied rows.
  const before=(await db.query('select count(*)::int as n from worklog.schedules')).rows[0].n;
  await assert.rejects(db.transaction(async tx=>{await tx.query('insert into worklog.schedules(workspace_id,created_by_user_id,title,starts_at) values($1,$2,$3,now())',[space,erp,'rollback']);await tx.query('insert into worklog.workspace_members(workspace_id,user_id,role) values($1,$2,$3)',[schedule,erp,'owner']);}),/foreign key/);
  assert.equal((await db.query('select count(*)::int as n from worklog.schedules')).rows[0].n,before);
 }finally{await db.close();}
});

test('Google linking preserves ERP ID and blocks occupied emails even on deleted/unconfirmed profiles',async()=>{
 const {identityPreflight}=await import('../scripts/consolidation/identity-preflight.mjs');
 const input={erpActor:{id:erp,accountStatus:'active',emailVerified:true},worklogActor:{id:old,emailVerified:true,providers:['google']}};
 assert.equal(identityPreflight(input).ready,true);assert.equal(identityPreflight(input).preserveErpAuthId,true);
 const blocked=identityPreflight({...input,targetEmailOccupants:[{id:other,accountStatus:'deleted',emailVerified:false}]});
 assert.equal(blocked.ready,false);assert.deepEqual(blocked.blockers,['GOOGLE_EMAIL_COLLISION']);
 assert.equal(identityPreflight({...input,worklogActor:{...input.worklogActor,providers:['email']}}).ready,false);
});
