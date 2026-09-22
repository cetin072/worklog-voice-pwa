import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { createWorklogDataCoreEditor } from "../netlify/shared/worklog-data-core-editor.mjs";

const migration=fs.readFileSync("supabase/migrations/20260919130000_stage3_note_task_conversion.sql","utf8");
const endpoint=fs.readFileSync("netlify/functions/worklog-edit.mts","utf8");
const sheet=fs.readFileSync("mobile/src/features/work/work-record-edit-sheet.tsx","utf8");
const home=fs.readFileSync("mobile/app/index.tsx","utf8");
const search=fs.readFileSync("mobile/src/features/search/work-record-search.tsx","utf8");
const api=fs.readFileSync("mobile/src/platform/worklog-api.ts","utf8");

function rpcClient(handler){
  return { rpc: handler };
}

test("V2 edit reader exposes action kind and conversion eligibility",async()=>{
  const calls=[];
  const editor=createWorklogDataCoreEditor({client:rpcClient(async(name,body)=>{
    calls.push({name,body});
    if(name==="get_my_work_record_edit_v2"){
      return [{
        record_id:"11111111-1111-4111-8111-111111111111",
        title_value:"강대표 계약 확인",
        due_at_value:null,
        due_has_time:false,
        action_kind_value:"note",
        action_conversion_allowed:true,
      }];
    }
    throw new Error("unexpected rpc");
  })});

  const result=await editor.readDetails({recordId:"11111111-1111-4111-8111-111111111111"});
  assert.deepEqual(calls,[{name:"get_my_work_record_edit_v2",body:{p_record_id:"11111111-1111-4111-8111-111111111111"}}]);
  assert.equal(result.actionKind,"note");
  assert.equal(result.actionConversionAllowed,true);
});

test("missing V2 reader falls back to v1 without enabling conversion",async()=>{
  const calls=[];
  const error=Object.assign(new Error("Could not find the function public.get_my_work_record_edit_v2 in the schema cache"),{code:"SUPABASE_DATA_CORE_RPC_FAILED"});
  const editor=createWorklogDataCoreEditor({client:rpcClient(async(name,body)=>{
    calls.push({name,body});
    if(name==="get_my_work_record_edit_v2") throw error;
    if(name==="get_my_work_record_edit"){
      return [{title_value:"기존 업무",due_at_value:null,due_has_time:false}];
    }
    throw new Error("unexpected rpc");
  })});

  const result=await editor.readDetails({recordId:"11111111-1111-4111-8111-111111111111"});
  assert.equal(calls.length,2);
  assert.equal(result.actionKind,null);
  assert.equal(result.actionConversionAllowed,false);
});

test("conversion update uses V2 RPC and preserves normal edit fields",async()=>{
  const calls=[];
  const editor=createWorklogDataCoreEditor({client:rpcClient(async(name,body)=>{
    calls.push({name,body});
    return [{
      title_value:"강대표 계약 확인",
      due_at_value:"2026-09-25T00:00:00+09:00",
      due_has_time:false,
      action_kind_value:"task",
      action_kind_changed:true,
      schedule_updated:false,
    }];
  })});

  const result=await editor.updateDetails({
    recordId:"11111111-1111-4111-8111-111111111111",
    title:"강대표 계약 확인",
    dueAt:"2026-09-25T00:00:00+09:00",
    dueHasTime:false,
    actionKind:"task",
  });

  assert.equal(calls[0].name,"update_my_work_record_details_v2");
  assert.equal(calls[0].body.p_action_kind,"task");
  assert.equal(calls[0].body.p_due_at,"2026-09-25T00:00:00+09:00");
  assert.equal(result.actionKind,"task");
  assert.equal(result.actionKindChanged,true);
});

test("conversion fails closed when V2 mutation is unavailable",async()=>{
  const error=Object.assign(new Error("Could not find update_my_work_record_details_v2 in the schema cache"),{code:"SUPABASE_DATA_CORE_RPC_FAILED"});
  const editor=createWorklogDataCoreEditor({client:rpcClient(async()=>{throw error;})});
  await assert.rejects(
    ()=>editor.updateDetails({
      recordId:"11111111-1111-4111-8111-111111111111",
      title:"업무",
      actionKind:"note",
    }),
    (next)=>next?.code==="WORKLOG_DATA_CORE_EDIT_ACTION_CONVERSION_UNAVAILABLE"
  );
});

test("non-conversion editing still uses the legacy RPC for deploy compatibility",async()=>{
  const calls=[];
  const editor=createWorklogDataCoreEditor({client:rpcClient(async(name,body)=>{
    calls.push({name,body});
    return [{title_value:"업무 수정",due_at_value:null,due_has_time:false,schedule_updated:false}];
  })});
  await editor.updateDetails({
    recordId:"11111111-1111-4111-8111-111111111111",
    title:"업무 수정",
  });
  assert.equal(calls[0].name,"update_my_work_record_details");
  assert.equal("p_action_kind" in calls[0].body,false);
});

test("conversion RPC is creator-scoped SECURITY INVOKER and rejects linked Schedule sources",()=>{
  assert.match(migration,/create or replace function public\.get_my_work_record_edit_v2\(/i);
  assert.match(migration,/create or replace function public\.update_my_work_record_details_v2\(/i);
  assert.match(migration,/security invoker/ig);
  assert.doesNotMatch(migration,/security definer/i);
  assert.match(migration,/wr\.created_by_user_id = v_user_id/i);
  assert.match(migration,/s\.metadata ->> 'workRecordId' = wr\.id::text/i);
  assert.match(migration,/WORK_RECORD_ACTION_CONVERSION_SCHEDULE_LINKED/i);
  assert.match(migration,/v_action_kind not in \('task', 'note'\)/i);
  assert.match(migration,/briefing_state = case[\s\S]*then 'active'/i);
  assert.match(migration,/actionOverride[\s\S]*user_edit/i);
  assert.match(migration,/revoke all on function public\.update_my_work_record_details_v2[\s\S]*from public, anon/i);
  assert.match(migration,/grant execute on function public\.update_my_work_record_details_v2[\s\S]*to authenticated, service_role/i);
});

test("worklog edit API exposes conversion details and maps conversion errors",()=>{
  assert.match(endpoint,/actionKind:current\.actionKind \|\| ""/);
  assert.match(endpoint,/actionConversionAllowed:current\.actionConversionAllowed===true/);
  assert.match(endpoint,/requestedActionKind/);
  assert.match(endpoint,/actionKind:requestedActionKind \|\| null/);
  assert.match(endpoint,/WORKLOG_DATA_CORE_EDIT_ACTION_SCHEDULE_LINKED/);
  assert.match(endpoint,/WORKLOG_DATA_CORE_EDIT_ACTION_CONVERSION_UNAVAILABLE/);
  assert.match(endpoint,/업무 종류 변경은 Data Core 업무에서만 지원합니다/);
});

test("mobile edit API carries action kind through read and update",()=>{
  assert.match(api,/export type WorklogEditActionKind = 'task' \| 'note'/);
  assert.match(api,/actionConversionAllowed\?: boolean/);
  assert.match(api,/body\.actionKind === 'task' \|\| body\.actionKind === 'note'/);
  assert.match(api,/input\.actionKind \? \{ actionKind: input\.actionKind \}/);
  assert.match(api,/actionKindChanged\?: boolean/);
});

test("shared edit sheet shows human labels only and hides conversion when action kind is unknown",()=>{
  assert.match(sheet,/actionKind\?: 'task' \| 'note'/);
  assert.match(sheet,/>할 일<\/Text>/);
  assert.match(sheet,/>메모 · 참고<\/Text>/);
  assert.match(sheet,/actionConversionAllowed \? '종류를 바꾸면 저장할 때 함께 반영됩니다\.'/);
  assert.doesNotMatch(sheet,/>Task<\/Text>|>Note<\/Text>|>Schedule<\/Text>/);
});

test("Home Note row keeps 확인했어요 primary while adding lower-priority edit access",()=>{
  assert.match(home,/function NoteRow\\(\\{ note, onEdit, onDelete, onAcknowledge/);
  assert.match(home,/note\.title \|\| '메모'[\s\S]{0,100}수정/);
  assert.match(home,/확인했어요/);
  assert.match(home,/async function openNoteEditor/);
  assert.match(home,/onEdit=\{\(\) => void openNoteEditor\(note\)\}/);
  assert.match(home,/actionKind=\{editActionKind\}/);
  assert.match(home,/onActionKind=\{setEditActionKind\}/);
  assert.match(home,/result\.actionKindChanged[\s\S]*메모 · 참고로 변경했습니다/);
  assert.match(home,/result\.actionKindChanged[\s\S]*할 일로 변경했습니다/);
});

test("Search edit sheet uses the same action kind conversion contract",()=>{
  assert.match(search,/editActionKind/);
  assert.match(search,/editActionConversionAllowed/);
  assert.match(search,/actionKind: editActionKind/);
  assert.match(search,/actionKind=\{editActionKind\}/);
  assert.match(search,/onActionKind=\{setEditActionKind\}/);
  assert.match(search,/메모 · 참고로 변경했습니다/);
  assert.match(search,/할 일로 변경했습니다/);
});

test("mobile only requests kind conversion after the user changes the loaded kind",()=>{
  assert.match(home,/editOriginalActionKind/);
  assert.match(home,/editActionKind !== editOriginalActionKind/);
  assert.match(search,/editOriginalActionKind/);
  assert.match(search,/editActionKind !== editOriginalActionKind/);
});

test("conversion SQL is limited to classified task-note records and records overrides only for real changes",()=>{
  assert.match(migration,/wr\.action_kind in \('task', 'note'\)[\s\S]*and not exists/i);
  assert.match(migration,/WORK_RECORD_ACTION_CONVERSION_UNCLASSIFIED/i);
  assert.match(migration,/when v_action_kind in \('task', 'note'\) and v_action_kind is distinct from wr\.action_kind then jsonb_build_object/i);
});

