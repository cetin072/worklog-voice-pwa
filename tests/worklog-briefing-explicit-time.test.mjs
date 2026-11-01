import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorklogDataCoreBriefingSource } from '../netlify/shared/worklog-data-core-briefing-source.mjs';

test('briefing preserves explicit time from legacy RPC metadata for immediate editing', async () => {
  const inputs = [
    {id:'timed',metadata:{dueTimeExplicit:true}},
    {id:'all-day',metadata:{dueTimeExplicit:false}},
    {id:'unknown',metadata:{}},
    {id:'top-level-false',due_has_time:false,metadata:{dueTimeExplicit:true}},
    {id:'top-level-true',due_has_time:true,metadata:{dueTimeExplicit:false}},
    {id:'invalid',metadata:{dueTimeExplicit:'true'}},
  ];
  const source = createWorklogDataCoreBriefingSource({client:{rpc:async()=>({
    workspace_id:'synthetic',today:'2026-11-02',schedules:[],
    tasks:inputs.map(row=>({title:row.id,status:'in_progress',due_at:'2026-11-02T01:30:00Z',...row})),
  })}});
  const {tasks} = await source.load();
  const time=id=>tasks.find(row=>row.pageId===id).dueTime;
  assert.equal(time('timed'),'10:30');
  assert.equal(time('all-day'),'');
  assert.equal(time('unknown'),undefined);
  assert.equal(time('top-level-false'),'');
  assert.equal(time('top-level-true'),'10:30');
  assert.equal(time('invalid'),undefined);
});
