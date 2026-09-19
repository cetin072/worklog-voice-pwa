import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  MULTI_ACTION_MAX_SEGMENTS,
  multiActionChildRequestId,
  splitMultiActionText,
} from "../netlify/shared/multi-action-splitter.mjs";
import { createWorklogDataCoreAdapter } from "../netlify/shared/worklog-data-core-adapter.mjs";

const migration=fs.readFileSync("supabase/migrations/20260919100000_stage3_multi_action_capture.sql","utf8");
const schema=fs.readFileSync("supabase/schemas/01_data_core_v1.sql","utf8");
const worklog=fs.readFileSync("netlify/functions/worklog.mts","utf8");
const mobileApi=fs.readFileSync("mobile/src/platform/worklog-api.ts","utf8");
const mobileHome=fs.readFileSync("mobile/app/index.tsx","utf8");

test("web-proven split markers divide one transcript into explicit Actions",()=>{
  const input="내일 오후 2시 삼현 미팅 다음 업무 금요일까지 견적서 보내기 그리고 그다음 강대표가 계약 조건 다시 본다고 함";
  const result=splitMultiActionText(input);
  assert.equal(result.matched,true);
  assert.equal(result.truncated,false);
  assert.deepEqual(result.segments,[
    "내일 오후 2시 삼현 미팅",
    "금요일까지 견적서 보내기",
    "강대표가 계약 조건 다시 본다고 함",
  ]);
});

test("plain 그리고 does not silently split work",()=>{
  const result=splitMultiActionText("삼현 미팅하고 그리고 견적서 보내기");
  assert.equal(result.matched,false);
  assert.deepEqual(result.segments,["삼현 미팅하고 그리고 견적서 보내기"]);
});

test("legacy explicit marker vocabulary remains supported",()=>{
  for(const marker of [
    "그 다음 업무",
    "그다음 건",
    "다음 업무",
    "다음 할 일",
    "또 다른 업무",
    "별개 업무",
    "별도 업무",
    "새로운 업무",
    "두 번째 업무",
    "세 번째 업무",
    "네 번째 업무",
  ]){
    const result=splitMultiActionText(`첫 번째 내용 ${marker} 두 번째 내용`);
    assert.equal(result.matched,true,marker);
    assert.equal(result.segments.length,2,marker);
  }
});

test("splitter refuses to auto-process more than the bounded maximum",()=>{
  const parts=Array.from({length:MULTI_ACTION_MAX_SEGMENTS+1},(_,i)=>`업무 ${i+1}`);
  const input=parts.join(" 다음 업무 ");
  const result=splitMultiActionText(input);
  assert.equal(result.matched,true);
  assert.equal(result.truncated,true);
  assert.equal(result.segments.length,MULTI_ACTION_MAX_SEGMENTS);
});

test("child request ids are deterministic, bounded, and unique by segment",()=>{
  const parent="mobile-20260919-abcdef123456";
  const one=multiActionChildRequestId(parent,0);
  const oneAgain=multiActionChildRequestId(parent,0);
  const two=multiActionChildRequestId(parent,1);
  assert.equal(one,oneAgain);
  assert.notEqual(one,two);
  assert.match(one,/^multi-[0-9a-f]{24}-01$/);
  assert.ok(one.length<=100);
});

function record(clientRequestId,transcript,kind,journalDate,dueStart=""){
  return {
    clientRequestId,
    transcript,
    cleanTranscript:transcript,
    status:"진행중",
    type:kind==="schedule" ? "회의·통화" : kind==="task" ? "할 일" : "기타",
    actionKind:kind==="schedule" ? null : kind,
    journalDate,
    actionEngine:{
      version:"action-engine-v1",
      kind,
      actionKind:kind==="schedule" ? null : kind,
      journalDate,
      reason:kind==="schedule" ? "timed_event" : kind==="task" ? "explicit_action" : "reported_fact",
      confidence:0.95,
      needsReview:false,
    },
    recordedAt:"2026-09-19T18:00:00+09:00",
    dueStart,
  };
}

test("atomic adapter sends every child in one RPC with one original capture",async()=>{
  const calls=[];
  const parent="mobile-20260919-multi123456";
  const records=[
    record(multiActionChildRequestId(parent,0),"내일 오후 2시 삼현 미팅","schedule","2026-09-20","2026-09-20T14:00:00+09:00"),
    record(multiActionChildRequestId(parent,1),"금요일까지 견적서 보내기","task","2026-09-25","2026-09-25"),
    record(multiActionChildRequestId(parent,2),"강대표가 계약 조건 다시 본다고 함","note","2026-09-19"),
  ];
  const client={
    insert:async()=>{ throw new Error("insert not expected"); },
    upsert:async()=>{ throw new Error("upsert not expected"); },
    async rpc(name,body){
      calls.push({name,body});
      return [{
        capture_id:"11111111-1111-1111-1111-111111111111",
        saved_count:3,
        work_record_ids:[
          "21111111-1111-1111-1111-111111111111",
          "31111111-1111-1111-1111-111111111111",
          "41111111-1111-1111-1111-111111111111",
        ],
        source_ref_ids:[
          "51111111-1111-1111-1111-111111111111",
          "61111111-1111-1111-1111-111111111111",
          "71111111-1111-1111-1111-111111111111",
        ],
        schedule_ids:["81111111-1111-1111-1111-111111111111"],
      }];
    },
  };

  const result=await createWorklogDataCoreAdapter({client}).persistManyFast({
    parentRequestId:parent,
    originalText:"내일 오후 2시 삼현 미팅 다음 업무 금요일까지 견적서 보내기 다음 업무 강대표가 계약 조건 다시 본다고 함",
    source:"voice",
    recordedAt:"2026-09-19T18:00:00+09:00",
    records,
  });

  assert.equal(calls.length,1);
  assert.equal(calls[0].name,"save_my_multi_action_worklog");
  assert.equal(calls[0].body.p_parent_request_id,parent);
  assert.equal(calls[0].body.p_source_type,"voice");
  assert.equal(calls[0].body.p_items.length,3);
  assert.equal(calls[0].body.p_items[0].scheduleTitle,"내일 오후 2시 삼현 미팅");
  assert.equal(calls[0].body.p_items[1].metadata.actionEngine.actionKind,"task");
  assert.equal(calls[0].body.p_items[2].metadata.actionEngine.actionKind,"note");
  assert.equal(result.multiAction,true);
  assert.equal(result.savedCount,3);
  assert.equal(result.workRecordIds.length,3);
  assert.equal(result.scheduleIds.length,1);
});

test("input capture schema is owner-scoped and original text is stored once",()=>{
  assert.match(migration,/create table public\.input_captures/i);
  assert.match(migration,/unique \(workspace_id, client_request_id\)/i);
  assert.match(migration,/original_text text not null default '' check \(char_length\(original_text\) <= 10000\)/i);
  assert.match(migration,/alter table public\.input_captures enable row level security/i);
  assert.match(migration,/input_captures_insert_creator[\s\S]*created_by_user_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration,/input_captures_update_creator[\s\S]*created_by_user_id = \(select auth\.uid\(\)\)/i);
  assert.match(schema,/create table public\.input_captures/i);
});

test("multi-action RPC is authenticated-only, bounded, atomic and reuses canonical child save",()=>{
  assert.match(migration,/create or replace function public\.save_my_multi_action_worklog\(/i);
  assert.match(migration,/security invoker/i);
  assert.match(migration,/v_count < 2 or v_count > 8/i);
  assert.match(migration,/from public\.save_my_worklog_with_schedule\(/i);
  assert.match(migration,/multi-' \|\| substr\(md5\(v_parent_request_id\), 1, 24\) \|\| '-' \|\| lpad\(v_index::text, 2, '0'\)/i);
  assert.match(migration,/set source_type = v_source_type,[\s\S]*source_id = v_parent_request_id/i);
  assert.match(migration,/revoke all on function public\.save_my_multi_action_worklog[\s\S]*from public, anon/i);
  assert.match(migration,/grant execute on function public\.save_my_multi_action_worklog[\s\S]*to authenticated, service_role/i);
  assert.doesNotMatch(migration,/security definer/i);
});

test("canonical worklog only auto-splits voice with no manual detail fields",()=>{
  assert.match(worklog,/sourceType==="voice"/);
  assert.match(worklog,/!hasManualExtras/);
  assert.match(worklog,/!requestedStatus/);
  assert.match(worklog,/!requestedType/);
  assert.match(worklog,/multiRecords\.length>1[\s\S]*persistManyFast/);
  assert.match(worklog,/multi-action RPC unavailable; preserving original as one WorkRecord/);
  assert.match(worklog,/multiAction:true/);
  assert.match(worklog,/splitCount/);
});

test("mobile Quick Voice declares voice provenance while direct input stays default direct",()=>{
  assert.match(mobileApi,/sourceType\?: 'direct' \| 'voice'/);
  assert.match(mobileApi,/options\.sourceType \? \{ sourceType: options\.sourceType \}/);
  assert.match(mobileHome,/\{ \.\.\.options, sourceType: 'voice' \}/);
  assert.doesNotMatch(mobileHome,/persistDraft\([\s\S]{0,500}sourceType: 'voice'/);
});

test("input capture creator foreign key has a covering index",()=>{
  const perfMigration=fs.readFileSync("supabase/migrations/20260919102000_input_captures_creator_fk_index.sql","utf8");
  assert.match(perfMigration,/create index input_captures_created_by_user_id_idx[\s\S]*created_by_user_id/i);
  assert.match(schema,/create index input_captures_created_by_user_id_idx[\s\S]*created_by_user_id/i);
});
