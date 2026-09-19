import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { createWorklogDataCoreBriefingSource } from "../netlify/shared/worklog-data-core-briefing-source.mjs";
import { createWorklogDataCoreBriefingNote } from "../netlify/shared/worklog-data-core-briefing-note.mjs";

const migration=fs.readFileSync("supabase/migrations/20260919110000_stage3_briefing_notes.sql","utf8");
const fastEndpoint=fs.readFileSync("netlify/functions/briefing-fast.mts","utf8");
const noteEndpoint=fs.readFileSync("netlify/functions/briefing-note.mts","utf8");
const mobileApi=fs.readFileSync("mobile/src/platform/worklog-api.ts","utf8");
const mobileHome=fs.readFileSync("mobile/app/index.tsx","utf8");

const recordId="11111111-1111-4111-8111-111111111111";

test("fast briefing source keeps Tasks and active Notes separate",async()=>{
  const client={
    async rpc(name,body){
      assert.equal(name,"get_my_briefing_source");
      assert.deepEqual(body,{});
      return [{
        workspace_id:"22222222-2222-4222-8222-222222222222",
        today:"2026-09-19",
        tasks:[{
          id:"31111111-1111-4111-8111-111111111111",
          title:"견적서 보내기",
          status:"in_progress",
          due_at:"2026-09-25T00:00:00+09:00",
          updated_at:"2026-09-19T10:00:00+09:00",
          metadata:{},
        }],
        notes:[{
          id:recordId,
          title:"강대표가 계약 조건 다시 본다고 함",
          institution:"태장",
          journal_date:"2026-09-19",
          recorded_at:"2026-09-19T09:00:00+09:00",
          updated_at:"2026-09-19T09:30:00+09:00",
        }],
        schedules:[],
      }];
    },
  };
  const source=await createWorklogDataCoreBriefingSource({client}).load();
  assert.equal(source.tasks.length,1);
  assert.equal(source.tasks[0].title,"견적서 보내기");
  assert.equal(source.notes.length,1);
  assert.deepEqual(source.notes[0],{
    pageId:recordId,
    title:"강대표가 계약 조건 다시 본다고 함",
    institution:"태장",
    journalDate:"2026-09-19",
    recordedAt:"2026-09-19T09:00:00+09:00",
    editedAt:"2026-09-19T09:30:00+09:00",
  });
});

test("old briefing RPC shape remains readable before migration deploy",async()=>{
  const source=await createWorklogDataCoreBriefingSource({client:{rpc:async()=>[{
    workspace_id:"22222222-2222-4222-8222-222222222222",
    today:"2026-09-19",
    tasks:[],
    schedules:[],
  }]}}).load();
  assert.deepEqual(source.notes,[]);
});

test("Note fast mutation uses dedicated RPC and supports acknowledge/undo",async()=>{
  const calls=[];
  const writer=createWorklogDataCoreBriefingNote({
    client:{
      update:async()=>{ throw new Error("legacy update not expected"); },
      async rpc(name,body){
        calls.push({name,body});
        return [{record_id:recordId,briefing_state_value:body.p_state}];
      },
    },
  });
  assert.deepEqual(await writer.updateStateFast({recordId,state:"acknowledged"}),{recordId,state:"acknowledged"});
  assert.deepEqual(await writer.updateStateFast({recordId,state:"active"}),{recordId,state:"active"});
  assert.deepEqual(calls,[
    {name:"update_my_note_briefing_state",body:{p_record_id:recordId,p_state:"acknowledged"}},
    {name:"update_my_note_briefing_state",body:{p_record_id:recordId,p_state:"active"}},
  ]);
});

test("Note legacy fallback is workspace/creator/action_kind scoped",async()=>{
  const calls=[];
  const writer=createWorklogDataCoreBriefingNote({
    client:{
      rpc:async()=>[],
      async update(table,row,query){
        calls.push({table,row,query});
        return [{id:recordId,briefing_state:row.briefing_state}];
      },
    },
  });
  const context={
    workspaceId:"22222222-2222-4222-8222-222222222222",
    userId:"33333333-3333-4333-8333-333333333333",
    role:"owner",
  };
  await writer.updateState({recordId,state:"acknowledged"},context);
  assert.deepEqual(calls,[{
    table:"work_records",
    row:{briefing_state:"acknowledged"},
    query:{
      id:`eq.${recordId}`,
      workspace_id:`eq.${context.workspaceId}`,
      created_by_user_id:`eq.${context.userId}`,
      action_kind:"eq.note",
    },
  }]);
});

test("briefing SQL excludes Notes from Tasks and returns only active Notes",()=>{
  assert.match(migration,/wr\.action_kind is distinct from 'note'/i);
  assert.match(migration,/wr\.action_kind = 'note'[\s\S]*wr\.briefing_state = 'active'/i);
  assert.match(migration,/notes jsonb/i);
  assert.match(migration,/jsonb_agg\(to_jsonb\(n\)/i);
});

test("Note acknowledge RPC is authenticated-only, creator-scoped and note-only",()=>{
  assert.match(migration,/create or replace function public\.update_my_note_briefing_state\(/i);
  assert.match(migration,/security invoker/i);
  assert.doesNotMatch(migration,/security definer/i);
  assert.match(migration,/wr\.created_by_user_id = v_user_id/i);
  assert.match(migration,/wr\.action_kind = 'note'/i);
  assert.match(migration,/p_state not in \('active', 'acknowledged'\)/i);
  assert.match(migration,/revoke all on function public\.update_my_note_briefing_state\(uuid, text\) from public, anon/i);
  assert.match(migration,/grant execute on function public\.update_my_note_briefing_state\(uuid, text\) to authenticated, service_role/i);
});

test("fast endpoint returns notes without changing task counts",()=>{
  assert.match(fastEndpoint,/notes:Array\.isArray\(source\.notes\) \? source\.notes : \[\]/);
  assert.match(fastEndpoint,/counts:briefingV2Counts\(structure\)/);
});

test("Note endpoint uses fast RPC first and only falls back when the function is unavailable",()=>{
  assert.match(noteEndpoint,/updateStateFast/);
  assert.match(noteEndpoint,/rpcUnavailable\(fastError\)/);
  assert.match(noteEndpoint,/updateState\(\{recordId:body\.recordId,state:body\.state\},workspaceContext\)/);
  assert.match(noteEndpoint,/path:"\/api\/briefing-note"/);
});

test("mobile briefing contract accepts notes and exposes acknowledge API",()=>{
  assert.match(mobileApi,/export type BriefingNote/);
  assert.match(mobileApi,/notes\?: BriefingNote\[\]/);
  assert.match(mobileApi,/api\/briefing-note/);
  assert.match(mobileApi,/state: 'active' \| 'acknowledged'/);
});

test("mobile UX shows at most three Notes, visible 확인했어요, and Undo",()=>{
  assert.match(mobileHome,/const visibleNotes = notesExpanded \? notes : notes\.slice\(0, 3\)/);
  assert.match(mobileHome,/📝 메모 · 참고/);
  assert.match(mobileHome,/확인했어요 처리/);
  assert.match(mobileHome,/acknowledging \? '처리 중' : '확인했어요'/);
  assert.match(mobileHome,/updateBriefingNoteState\(session\.access_token, note\.pageId, 'acknowledged'\)/);
  assert.match(mobileHome,/removeVisibleNote\(note\.pageId\)/);
  assert.match(mobileHome,/메모를 브리핑에서 내렸습니다\./);
  assert.match(mobileHome,/updateBriefingNoteState\(session\.access_token, target\.pageId, 'active'\)/);
  assert.match(mobileHome,/실행 취소/);
});
