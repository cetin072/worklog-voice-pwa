import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createWorklogDataCoreBriefingReader } from '../netlify/shared/worklog-data-core-briefing-reader.mjs';
import { briefingCompleteness, BRIEFING_OPEN_TASK_REST_FILTER } from '../netlify/shared/briefing-completeness.mjs';

const migration = readFileSync('supabase/migrations/20261108193800_m20_home_briefing_schedule_parity.sql','utf8');
const fixture = readFileSync('tests/fixtures/m20-briefing-parity-public.sql','utf8');
const actor = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const space = '33333333-3333-4333-8333-333333333333';
const normal = '55555555-5555-4555-8555-555555555555';
const legacy = '66666666-6666-4666-8666-666666666666';
const cancelled = '99999999-9999-4999-8999-999999999999';
const foreign = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('real PostgreSQL WASM RPC preserves owner scope, legacy Tasks, calendar and 500-row boundary',async()=>{
  const db=new PGlite();
  try{
    await db.exec(fixture);
    await db.exec(migration);
    await db.exec("set role authenticated;select set_config('request.jwt.claim.sub','"+actor+"',false);");
    const load=async()=> (await db.query('select * from public.get_my_briefing_source()')).rows[0];
    let row=await load();
    assert.ok(row);
    assert.equal(row.workspace_id,space);
    assert.deepEqual(new Set(row.tasks.map(x=>x.id)),new Set([normal,legacy,cancelled]),
      '501 newer calendar-source records cannot evict the legitimate owner Tasks');
    assert.equal(row.notes.length,1);
    assert.equal(row.notes[0].id,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    assert.ok(row.schedules.some(x=>x.title==='Confirmed meeting'));
    assert.ok(row.schedules.some(x=>x.title==='Linked confirmed'));
    assert.ok(!row.schedules.some(x=>x.title==='Cancelled schedule'));
    assert.ok(!row.tasks.some(x=>x.id==='77777777-7777-4777-8777-777777777777'),
      'explicit actionEngine Schedule is not a Task');
    assert.ok(!row.tasks.some(x=>x.id==='88888888-8888-4888-8888-888888888888'),
      'legacy linked active Schedule is not another Task');
    await db.exec("select set_config('request.jwt.claim.sub','"+other+"',false)");
    row=await load();
    assert.equal(row.workspace_id,'44444444-4444-4444-8444-444444444444');
    assert.deepEqual(row.tasks.map(x=>x.id),[foreign]);
    assert.equal(row.notes.length,0);
    assert.equal(row.schedules.length,0);
    await db.exec("reset role");
    assert.equal((await db.query("select has_function_privilege('anon','public.get_my_briefing_source()','execute') as permitted")).rows[0].permitted,false);
  }finally{await db.close();}
});

test('fallback and pagination probe use owner-scoped Task+Schedule metadata filter before page limit',async()=>{
  const calls=[];
  const client={async select(table,query){
    calls.push({table,query});
    if(query.offset)return [];
    return [{id:normal,title:'Real Task',status:'in_progress',action_kind:'task',metadata:{}}];
  }};
  const result=await createWorklogDataCoreBriefingReader({client})
    .listOpenTasksWithMeta({userId:actor,workspaceId:space,role:'owner'});
  assert.deepEqual(result.tasks.map(t=>t.pageId),[normal]);
  assert.equal(calls[0].query.workspace_id,'eq.'+space);
  assert.equal(calls[0].query.and,BRIEFING_OPEN_TASK_REST_FILTER);
  assert.equal(calls[0].query.or,undefined);
  assert.equal(calls[0].query.limit,'500');
  await briefingCompleteness({client,workspaceId:space,sourceCount:500,displayedCount:500,rpcBounded:true});
  const probe=calls.at(-1);
  assert.equal(probe.table,'work_records');
  assert.equal(probe.query.and,BRIEFING_OPEN_TASK_REST_FILTER);
  assert.equal(probe.query.workspace_id,'eq.'+space);
  assert.equal(probe.query.offset,'500');
  assert.equal(probe.query.limit,'1');
});

test('public migration changes only owner-scoped projection and cannot mutate canonical records',()=>{
  assert.match(migration,/create or replace function public\.get_my_briefing_source\(\)/i);
  assert.match(migration,/security invoker/i);
  assert.match(migration,/owner_user_id\s*=\s*\(select auth\.uid\(\)\)/i);
  assert.match(migration,/wr\.metadata #>> '\{actionEngine,kind\}'\) is distinct from 'schedule'/i);
  assert.match(migration,/linked_schedule\.metadata ->> 'workRecordId' = wr\.id::text/i);
  assert.match(migration,/linked_schedule\.status <> 'cancelled'/i);
  assert.match(migration,/order by wr\.updated_at desc\s+limit 500/i);
  assert.match(migration,/revoke all on function public\.get_my_briefing_source\(\) from public, anon/i);
  assert.doesNotMatch(migration,/update\s+public\.work_records|delete\s+from|insert\s+into|security definer/i);
});
