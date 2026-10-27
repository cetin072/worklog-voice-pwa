import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorklogDataCoreBriefingReader } from '../netlify/shared/worklog-data-core-briefing-reader.mjs';
import { classifyBriefingTasks } from '../netlify/shared/briefing-v2.mjs';
// No server flag is used as alarm evidence. These fields seed only the record editor.
test('classification preserves known empty/timed edit fields and omits missing/invalid time',()=>{
 const rows=['09:30','',undefined,'25:99'].map((dueTime,i)=>({pageId:String(i),title:'Synthetic',status:'진행중',dueKey:'2030-01-01',dueTime}));
 const result=classifyBriefingTasks(rows,'2030-01-01');
 const tasks=result.today;
 assert.equal(tasks.find(t=>t.pageId==='0').dueTime,'09:30');assert.equal(tasks.find(t=>t.pageId==='1').dueTime,'');
 assert.equal(Object.hasOwn(tasks.find(t=>t.pageId==='2'),'dueTime'),false);assert.equal(Object.hasOwn(tasks.find(t=>t.pageId==='3'),'dueTime'),false);
});

test('Data Core read preserves Seoul midnight, all-day and missing time semantics',async()=>{
 const rows=[true,false,undefined].map((due_has_time,i)=>({id:String(i),title:'Synthetic',status:'in_progress',due_at:'2030-01-01T15:00:00Z',due_has_time}));
 const reader=createWorklogDataCoreBriefingReader({client:{async select(table,query){assert.equal(table,'work_records');assert.ok(query.select.includes('due_has_time'));assert.equal(query.workspace_id,'eq.synthetic-workspace');return rows;}}});
 const {tasks}=await reader.listOpenTasksWithMeta({userId:'synthetic-user',workspaceId:'synthetic-workspace',role:'owner'});
 assert.equal(tasks[0].dueKey,'2030-01-02');assert.equal(tasks[0].dueTime,'00:00');assert.equal(tasks[1].dueTime,'');assert.equal(Object.hasOwn(tasks[2],'dueTime'),false);
});
