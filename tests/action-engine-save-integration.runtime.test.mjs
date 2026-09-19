import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { createWorklogDataCoreAdapter } from "../netlify/shared/worklog-data-core-adapter.mjs";

const migration=fs.readFileSync("supabase/migrations/20260919093000_stage3_action_engine_projection.sql","utf8");
const worklogFunction=fs.readFileSync("netlify/functions/worklog.mts","utf8");

const workspaceContext={
  workspaceId:"22222222-2222-2222-2222-222222222222",
  userId:"11111111-1111-1111-1111-111111111111",
  role:"owner",
};

function actionRecord(overrides={}){
  return {
    clientRequestId:"req-20260919-action-1234",
    transcript:"금요일까지 견적서 보내기",
    cleanTranscript:"견적서 보내기",
    institution:"기타",
    institutionSource:"unverified",
    status:"진행중",
    type:"할 일",
    actionKind:"task",
    journalDate:"2026-09-25",
    actionEngine:{
      version:"action-engine-v1",
      kind:"task",
      actionKind:"task",
      journalDate:"2026-09-25",
      reason:"deadline_action",
      confidence:0.94,
      needsReview:false,
    },
    recordedAt:"2026-09-19T17:00:00+09:00",
    dueStart:"2026-09-25",
    ...overrides,
  };
}

test("fast save carries Action Engine metadata without changing RPC parameter contract",async()=>{
  const calls=[];
  const client={
    insert:async()=>{ throw new Error("insert not expected"); },
    upsert:async()=>{ throw new Error("upsert not expected"); },
    async rpc(name,body){
      calls.push({name,body});
      return [{
        user_id:workspaceContext.userId,
        workspace_id:workspaceContext.workspaceId,
        work_record_id:"33333333-3333-3333-3333-333333333333",
        source_ref_id:"44444444-4444-4444-4444-444444444444",
        schedule_id:null,
      }];
    },
  };
  await createWorklogDataCoreAdapter({client}).persistFast(actionRecord());
  assert.equal(calls.length,1);
  assert.equal(calls[0].name,"save_my_worklog_with_schedule");
  assert.equal(calls[0].body.p_metadata.actionEngine.actionKind,"task");
  assert.equal(calls[0].body.p_metadata.actionEngine.journalDate,"2026-09-25");
  assert.equal(calls[0].body.p_metadata.actionEngine.reason,"deadline_action");
  assert.equal(calls[0].body.p_schedule_title,null);
});

test("legacy Data Core upsert writes action_kind and journal_date columns",async()=>{
  const rows=[];
  const client={
    insert:async()=>{ throw new Error("insert not expected"); },
    async upsert(table,row){
      rows.push({table,row});
      if(table==="work_records") return {id:"33333333-3333-3333-3333-333333333333",...row};
      if(table==="source_refs") return {id:"44444444-4444-4444-4444-444444444444",...row};
      throw new Error("unexpected table");
    },
  };
  await createWorklogDataCoreAdapter({client}).persist(actionRecord(),workspaceContext);
  const work=rows.find((entry)=>entry.table==="work_records")?.row;
  assert.equal(work.action_kind,"task");
  assert.equal(work.journal_date,"2026-09-25");
  assert.equal(work.metadata.actionEngine.kind,"task");
});

test("Schedule source keeps action_kind null while retaining schedule classification provenance",async()=>{
  const calls=[];
  const client={
    insert:async()=>{ throw new Error("insert not expected"); },
    upsert:async()=>{ throw new Error("upsert not expected"); },
    async rpc(name,body){
      calls.push({name,body});
      return [{
        user_id:workspaceContext.userId,
        workspace_id:workspaceContext.workspaceId,
        work_record_id:"33333333-3333-3333-3333-333333333333",
        source_ref_id:"44444444-4444-4444-4444-444444444444",
        schedule_id:"55555555-5555-5555-5555-555555555555",
      }];
    },
  };
  await createWorklogDataCoreAdapter({client}).persistFast(actionRecord({
    transcript:"내일 오후 2시에 삼현 미팅",
    cleanTranscript:"삼현 미팅",
    type:"회의·통화",
    actionKind:null,
    journalDate:"2026-09-20",
    dueStart:"2026-09-20T14:00:00+09:00",
    actionEngine:{
      version:"action-engine-v1",
      kind:"schedule",
      actionKind:null,
      journalDate:"2026-09-20",
      reason:"timed_event",
      confidence:0.98,
      needsReview:false,
    },
  }));
  assert.equal(calls[0].body.p_metadata.actionEngine.kind,"schedule");
  assert.equal(calls[0].body.p_metadata.actionEngine.actionKind,null);
  assert.equal(calls[0].body.p_schedule_title,"삼현 미팅");
});

test("projection migration keeps the existing authenticated RPC signature and projects metadata only when present",()=>{
  assert.match(migration,/create or replace function public\.save_my_worklog_with_schedule\(/i);
  assert.match(migration,/jsonb_typeof\(coalesce\(p_metadata,[\s\S]*-> 'actionEngine'\) = 'object'/i);
  assert.match(migration,/set action_kind = v_action_kind,[\s\S]*journal_date = coalesce\(v_journal_date, wr\.journal_date\)/i);
  assert.match(migration,/security invoker/i);
  assert.match(migration,/revoke all on function public\.save_my_worklog_with_schedule[\s\S]*from public, anon/i);
  assert.match(migration,/grant execute on function public\.save_my_worklog_with_schedule[\s\S]*to authenticated, service_role/i);
});

test("canonical worklog handler classifies every segment before building its saved record",()=>{
  const helperIndex=worklogFunction.indexOf("function classifiedRecord");
  const classifyIndex=worklogFunction.indexOf("const segmentAction=classifyWorklogAction",helperIndex);
  const recordIndex=worklogFunction.indexOf("record:{",classifyIndex);
  assert.ok(helperIndex>=0);
  assert.ok(classifyIndex>helperIndex);
  assert.ok(recordIndex>classifyIndex);
  assert.match(worklogFunction,/actionKind:segmentAction\.actionKind, journalDate:segmentAction\.journalDate, actionEngine/);
  assert.match(worklogFunction,/split\.segments\.map\(\(segment,index\)=>classifiedRecord/);
  assert.match(worklogFunction,/actionClass:action\.kind/);
  assert.match(worklogFunction,/actionNeedsReview:action\.needsReview/);
});
