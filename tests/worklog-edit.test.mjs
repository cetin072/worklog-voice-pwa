import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeWorklogDueInput, normalizeWorklogTitle, validWorklogPageId } from "../netlify/shared/worklog-edit.mjs";
import { createWorklogDataCoreEditor } from "../netlify/shared/worklog-data-core-editor.mjs";

const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const clientSource=read("public/briefing-edit.js");
const endpointSource=read("netlify/functions/worklog-edit.mts");
const indexSource=read("public/index.html");
const migrationSource=read("supabase/migrations/20260916143047_worklog_edit_details_v1.sql");

test("normalizeWorklogTitle trims and collapses whitespace",()=>{
  assert.equal(normalizeWorklogTitle("  범한매카텍   견적\n확인  "),"범한매카텍 견적 확인");
});

test("validWorklogPageId accepts Notion UUID forms",()=>{
  assert.equal(validWorklogPageId("12345678-1234-1234-1234-1234567890ab"),true);
  assert.equal(validWorklogPageId("123456781234123412341234567890ab"),true);
  assert.equal(validWorklogPageId("demo"),false);
});

test("due edit normalizes Seoul date/time and supports date-only or clearing",()=>{
  assert.deepEqual(normalizeWorklogDueInput("2026-09-18","14:30"),{
    dueDate:"2026-09-18",dueTime:"14:30",dueAt:"2026-09-18T14:30:00+09:00",dueHasTime:true
  });
  assert.deepEqual(normalizeWorklogDueInput("2026-09-18",""),{
    dueDate:"2026-09-18",dueTime:"",dueAt:"2026-09-18T00:00:00+09:00",dueHasTime:false
  });
  assert.deepEqual(normalizeWorklogDueInput("",""),{dueDate:"",dueTime:"",dueAt:null,dueHasTime:false});
  assert.throws(()=>normalizeWorklogDueInput("","09:00"),error=>error?.code==="WORKLOG_EDIT_DUE_DATE_REQUIRED");
  assert.throws(()=>normalizeWorklogDueInput("2026-02-30",""),error=>error?.code==="WORKLOG_EDIT_DUE_DATE_INVALID");
  assert.throws(()=>normalizeWorklogDueInput("2026-09-18","25:00"),error=>error?.code==="WORKLOG_EDIT_DUE_TIME_INVALID");
});

test("Data Core editor reads and updates through scoped RPCs",async()=>{
  const calls=[];
  const id="12345678-1234-1234-1234-1234567890ab";
  const client={
    async rpc(name,body){
      calls.push({name,body});
      if(name==="get_my_work_record_edit_v2") return [{record_id:id,title_value:"기존 업무",due_at_value:"2026-09-18T05:30:00+00:00",due_has_time:true,action_kind_value:"task",action_conversion_allowed:true}];
      return [{record_id:id,title_value:"수정 업무",due_at_value:"2026-09-19T00:00:00+09:00",due_has_time:false,schedule_updated:true}];
    }
  };
  const editor=createWorklogDataCoreEditor({client});
  const current=await editor.readDetails({recordId:id});
  const updated=await editor.updateDetails({recordId:id,title:"  수정   업무 ",dueAt:"2026-09-19T00:00:00+09:00",dueHasTime:false});
  assert.deepEqual(calls,[
    {name:"get_my_work_record_edit_v2",body:{p_record_id:id}},
    {name:"update_my_work_record_details",body:{p_record_id:id,p_title:"수정 업무",p_due_at:"2026-09-19T00:00:00+09:00",p_due_has_time:false}}
  ]);
  assert.deepEqual(current,{recordId:id,title:"기존 업무",dueAt:"2026-09-18T05:30:00+00:00",dueHasTime:true,actionKind:"task",actionConversionAllowed:true});
  assert.deepEqual(updated,{recordId:id,title:"수정 업무",dueAt:"2026-09-19T00:00:00+09:00",dueHasTime:false,actionKind:null,actionKindChanged:false,scheduleUpdated:true});
});

test("Data Core editor fails closed for missing/forbidden records",async()=>{
  const editor=createWorklogDataCoreEditor({client:{rpc:async()=>{const error=new Error("WORK_RECORD_NOT_FOUND_OR_FORBIDDEN");error.code="SUPABASE_DATA_CORE_RPC_FAILED";throw error;}}});
  await assert.rejects(()=>editor.readDetails({recordId:"12345678-1234-1234-1234-1234567890ab"}),error=>error?.code==="WORKLOG_DATA_CORE_EDIT_NOT_FOUND_OR_FORBIDDEN");
});

test("Stage 4 reminder editor keeps postpone and attention as separate scoped RPCs",async()=>{
  const calls=[];
  const id="12345678-1234-1234-1234-1234567890ab";
  const editor=createWorklogDataCoreEditor({client:{rpc:async(name,body)=>{
    calls.push({name,body});
    if(name==="postpone_my_work_record") return [{record_id:id,due_at_value:"2026-09-20T00:00:00+09:00",due_has_time:false,previous_due_at_value:"2026-09-18T00:00:00+09:00",previous_due_has_time:false}];
    if(name==="set_my_work_record_attention") return [{record_id:id,next_attention_at_value:"2026-09-21T09:00:00+09:00",previous_attention_at_value:null}];
    return [{record_id:id,due_at_value:"2026-09-18T00:00:00+09:00",due_has_time:false}];
  }}});
  assert.deepEqual(await editor.postpone({recordId:id,dueAt:"2026-09-20T00:00:00+09:00",dueHasTime:false}),{recordId:id,dueAt:"2026-09-20T00:00:00+09:00",dueHasTime:false,previousDueAt:"2026-09-18T00:00:00+09:00",previousDueHasTime:false});
  assert.deepEqual(await editor.setAttention({recordId:id,nextAttentionAt:"2026-09-21T09:00:00+09:00"}),{recordId:id,nextAttentionAt:"2026-09-21T09:00:00+09:00",previousAttentionAt:null});
  assert.deepEqual(await editor.undoPostpone({recordId:id}),{recordId:id,dueAt:"2026-09-18T00:00:00+09:00",dueHasTime:false});
  assert.deepEqual(calls,[
    {name:"postpone_my_work_record",body:{p_record_id:id,p_due_at:"2026-09-20T00:00:00+09:00",p_due_has_time:false}},
    {name:"set_my_work_record_attention",body:{p_record_id:id,p_next_attention_at:"2026-09-21T09:00:00+09:00"}},
    {name:"undo_my_work_record_postpone",body:{p_record_id:id}}
  ]);
});

test("Platform briefing edit loads current details and saves title date and time without legacy prompt",()=>{
  assert.match(clientSource,/mode\(\)===\"data_core\"/);
  assert.match(clientSource,/WorklogPlatformAuth\?\.readSession\?\.\(\)/);
  assert.match(clientSource,/authorization:`Bearer \$\{session\.access_token\}`/);
  assert.match(clientSource,/action:\"read\"/);
  assert.match(clientSource,/action:\"update\"/);
  assert.match(clientSource,/id=\"briefingEditDate\"/);
  assert.match(clientSource,/id=\"briefingEditTime\"/);
  assert.match(clientSource,/dueDate:dateInput\.value/);
  assert.match(clientSource,/dueTime:timeInput\.value/);
  assert.match(clientSource,/WorklogAuth\.getHeaders\(\{promptOwner:true\}\)/);
  assert.match(clientSource,/worklog:record-saved/);
});

test("worklog edit endpoint uses Data Core detail RPCs first and preserves legacy Notion fallback",()=>{
  const bearerIndex=endpointSource.indexOf("if(accessToken)");
  const legacyIndex=endpointSource.indexOf("const connection:any=resolveConnection(req)");
  assert.ok(bearerIndex>=0 && legacyIndex>bearerIndex,"Data Core bearer path must run before legacy Notion resolution");
  assert.match(endpointSource,/createWorklogDataCoreEditor/);
  assert.match(endpointSource,/editor\.readDetails/);
  assert.match(endpointSource,/editor\.updateDetails/);
  assert.match(endpointSource,/hasDueFields/);
  assert.match(endpointSource,/updateNotionWorklog/);
  assert.match(endpointSource,/mode:\"data_core\"/);
});

test("edit RPC migration is invoker-scoped and synchronizes only linked schedules",()=>{
  assert.match(migrationSource,/get_my_work_record_edit/);
  assert.match(migrationSource,/update_my_work_record_details/);
  assert.match(migrationSource,/security invoker/i);
  assert.match(migrationSource,/wr\.created_by_user_id = v_user_id/);
  assert.match(migrationSource,/s\.created_by_user_id = v_user_id/);
  assert.match(migrationSource,/s\.metadata ->> 'workRecordId' = p_record_id::text/);
  assert.match(migrationSource,/when p_due_at is null then 'cancelled'/);
  assert.match(migrationSource,/revoke all on function public\.update_my_work_record_details[^;]+ from public/i);
  assert.match(migrationSource,/grant execute on function public\.update_my_work_record_details[^;]+ to authenticated/i);
});

test("Stage 4 postpone and attention SQL are invoker-scoped, owner-scoped, and never move linked schedules",()=>{
  const migration=read("supabase/migrations/20260919170640_stage4_postpone_remind.sql");
  assert.match(migration,/create or replace function public\.postpone_my_work_record/i);
  assert.match(migration,/create or replace function public\.set_my_work_record_attention/i);
  assert.match(migration,/create or replace function public\.undo_my_work_record_postpone/i);
  assert.match(migration,/security invoker/gi);
  assert.match(migration,/wr\.created_by_user_id = v_user_id/);
  assert.match(migration,/WORK_RECORD_POSTPONE_SCHEDULE_LINKED/);
  assert.match(migration,/s\.metadata ->> 'workRecordId' = p_record_id::text/);
  assert.match(migration,/next_attention_at = p_next_attention_at/);
  assert.match(migration,/due_at = p_due_at/);
  assert.match(migration,/stage4Postpone/);
  assert.match(migration,/revoke all on function public\.postpone_my_work_record[^;]+ from public, anon/i);
  assert.match(migration,/grant execute on function public\.set_my_work_record_attention[^;]+ to authenticated, service_role/i);
});

test("worklog edit endpoint keeps Stage 4 actions on the Data Core path and fail-closes legacy mode",()=>{
  assert.match(endpointSource,/\["read","postpone","undo_postpone","attention","undo_attention"\]/);
  assert.match(endpointSource,/editor\.postpone/);
  assert.match(endpointSource,/editor\.undoPostpone/);
  assert.match(endpointSource,/editor\.setAttention/);
  assert.match(endpointSource,/editor\.undoAttention/);
  assert.match(endpointSource,/미루기와 다시 알림은 Data Core 업무에서만 지원합니다/);
});

test("main cache-busts the expanded briefing editor assets",()=>{
  assert.match(indexSource,/briefing-edit\.css\?v=20260916-2/);
  assert.match(indexSource,/briefing-edit\.js\?v=20260916-2/);
});
