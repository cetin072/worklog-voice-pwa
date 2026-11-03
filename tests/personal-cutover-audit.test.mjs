import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {CUTOVER_TABLES, personalCutoverQuery, comparePersonalCutover} from '../scripts/consolidation/personal-cutover-audit.mjs';

const source='11111111-1111-4111-8111-111111111111', target='22222222-2222-4222-8222-222222222222';
const snapshot=()=>({format:'personal-cutover-fingerprints-v1', tables:Object.fromEntries(CUTOVER_TABLES.map(t=>[t,[{id:t, fingerprint:'a'.repeat(32)}]]))});
test('cutover comparison keeps additions and conflicts separate without declaring production ready',()=>{
  const a=snapshot(),b=snapshot();
  a.tables.work_records.push({id:'source-only',fingerprint:'b'.repeat(32)});
  b.tables.work_records.push({id:'target-only',fingerprint:'c'.repeat(32)});
  b.tables.schedules[0].fingerprint='d'.repeat(32);
  const before=JSON.stringify([a,b]),r=comparePersonalCutover(a,b);
  assert.equal(r.status,'RECONCILIATION_REQUIRED');
  assert.deepEqual(r.tables.work_records.sourceOnly,['source-only']);
  assert.deepEqual(r.tables.work_records.targetOnly,['target-only']);
  assert.deepEqual(r.tables.schedules.changed,['schedules']);
  assert.equal(r.productionReady,false);assert.equal(JSON.stringify([a,b]),before);
  assert.equal(comparePersonalCutover(a,structuredClone(a)).status,'CORE_MATCH');
  assert.equal(comparePersonalCutover(a,structuredClone(a)).localDraftsVerified,false);
});
test('missing tables, duplicate IDs, empty owner scope and invalid hashes cannot pass',()=>{
  const a=snapshot();
  for(const mutate of [b=>delete b.tables.schedules,b=>b.tables.work_records.push(b.tables.work_records[0]),b=>b.tables.workspaces=[],b=>b.tables.work_records[0].fingerprint='invalid']){
    const b=snapshot();mutate(b);assert.throws(()=>comparePersonalCutover(a,b));
  }
  assert.throws(()=>personalCutoverQuery('auth',source),/INVALID_AUDIT_SCOPE/);
  assert.throws(()=>personalCutoverQuery('public',"';delete from auth.users;--"),/INVALID_AUDIT_SCOPE/);
});
test('PostgreSQL fingerprints normalize only approved Auth FKs and detect same-count edits',async()=>{
  const db=new PGlite();
  try{
    await db.exec('create schema worklog');
    for(const [schema,actor] of [['public',source],['worklog',target]]) {
      await db.exec(`create table ${schema}.workspaces(id text,kind text,owner_user_id uuid,created_by_user_id uuid);
      create table ${schema}.workspace_members(workspace_id text,user_id uuid,role text);
      create table ${schema}.work_records(id text,workspace_id text,created_by_user_id uuid,assigned_user_id uuid,title text,metadata jsonb);
      create table ${schema}.schedules(id text,workspace_id text,created_by_user_id uuid,title text);
      insert into ${schema}.workspaces values('space','personal','${actor}','${actor}'),('other','personal','33333333-3333-4333-8333-333333333333','${actor}');
      insert into ${schema}.workspace_members values('space','${actor}','owner');
      insert into ${schema}.work_records values('task','space','${actor}',null,'keep original','{"note":"${source}"}'),('hidden','other','${actor}',null,'other owner','{}');
      insert into ${schema}.schedules values('event','space','${actor}','meeting');`);
    }
    const read=async(s,u)=>(await db.query(personalCutoverQuery(s,u))).rows[0].snapshot;
    const a=await read('public',source), b=await read('worklog',target);
    assert.equal(a.tables.work_records.length,1);assert.equal(comparePersonalCutover(a,b).status,'CORE_MATCH');
    await db.exec(`update worklog.work_records set title='edited after pilot' where id='task'`);
    assert.deepEqual(comparePersonalCutover(a,await read('worklog',target)).tables.work_records.changed,['task']);
    await db.exec(`update worklog.work_records set title='keep original',metadata='{"note":"${target}"}' where id='task'`);
    assert.deepEqual(comparePersonalCutover(a,await read('worklog',target)).tables.work_records.changed,['task']);
    await db.exec("update worklog.workspace_members set role='member'");
    assert.throws(()=>comparePersonalCutover(a,{...b,tables:{...b.tables,workspace_members:[]}}),/PERSONAL_OWNER_SCOPE_REQUIRED/);
    assert.equal((await read('worklog',target)).tables.workspace_members.length,0);
  }finally{await db.close();}
});
