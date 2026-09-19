import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { createWorklogJournalReader } from "../netlify/shared/worklog-journal-reader.mjs";

const migration=fs.readFileSync("supabase/migrations/20260919120000_stage3_auto_work_journal.sql","utf8");
const endpoint=fs.readFileSync("netlify/functions/work-journal.mts","utf8");

test("journal reader normalizes four date-scoped sections from one RPC",async()=>{
  const calls=[];
  const client={
    async rpc(name,body){
      calls.push({name,body});
      return [{
        workspace_id:"11111111-1111-4111-8111-111111111111",
        target_date:"2026-09-19",
        today:"2026-09-19",
        schedules:[{
          id:"21111111-1111-4111-8111-111111111111",
          title:"삼현 대표 미팅",
          starts_at:"2026-09-19T14:00:00+09:00",
          all_day:false,
          status:"confirmed",
          location:"창원",
        }],
        completed:[{
          id:"31111111-1111-4111-8111-111111111111",
          title:"보험사 서류 전달",
          institution:"태장",
          status:"completed",
          follow_up:"",
          journal_date:"2026-09-19",
          due_at:null,
          completed_at:"2026-09-19T15:00:00+09:00",
          recorded_at:"2026-09-18T12:00:00+09:00",
        }],
        notes:[{
          id:"41111111-1111-4111-8111-111111111111",
          title:"강대표가 계약 조건 다시 검토 예정",
          institution:"태장",
          briefing_state:"acknowledged",
          journal_date:"2026-09-19",
          recorded_at:"2026-09-19T16:00:00+09:00",
          updated_at:"2026-09-19T16:10:00+09:00",
        }],
        open_tasks:[{
          id:"51111111-1111-4111-8111-111111111111",
          title:"견적서 보내기",
          institution:"태장",
          status:"in_progress",
          follow_up:"금요일까지",
          journal_date:"2026-09-19",
          due_at:"2026-09-19T18:00:00+09:00",
          completed_at:null,
          recorded_at:"2026-09-18T10:00:00+09:00",
        }],
      }];
    },
  };

  const result=await createWorklogJournalReader({client}).load("2026-09-19");
  assert.deepEqual(calls,[{name:"get_my_work_journal_day",body:{p_date:"2026-09-19"}}]);
  assert.equal(result.targetDate,"2026-09-19");
  assert.equal(result.today,"2026-09-19");
  assert.equal(result.schedules[0].title,"삼현 대표 미팅");
  assert.equal(result.completed[0].completedAt,"2026-09-19T15:00:00+09:00");
  assert.equal(result.notes[0].briefingState,"acknowledged");
  assert.equal(result.openTasks[0].title,"견적서 보내기");
});

test("journal reader fails closed for bad date and malformed source",async()=>{
  const reader=createWorklogJournalReader({client:{rpc:async()=>[]}});
  await assert.rejects(()=>reader.load("bad-date"),(error)=>error?.code==="WORKLOG_JOURNAL_DATE_INVALID");
  await assert.rejects(()=>reader.load("2026-09-19"),(error)=>error?.code==="WORKLOG_JOURNAL_SOURCE_INVALID");
});

test("journal RPC is authenticated-only SECURITY INVOKER and personal-workspace scoped",()=>{
  assert.match(migration,/create or replace function public\.get_my_work_journal_day\(/i);
  assert.match(migration,/security invoker/i);
  assert.doesNotMatch(migration,/security definer/i);
  assert.match(migration,/w\.owner_user_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration,/revoke all on function public\.get_my_work_journal_day\(date\) from public, anon/i);
  assert.match(migration,/grant execute on function public\.get_my_work_journal_day\(date\) to authenticated, service_role/i);
});

test("completed work uses real completion day and only falls back to journal date for legacy null completed_at",()=>{
  assert.match(migration,/wr\.completed_at is not null[\s\S]*wr\.completed_at at time zone 'Asia\/Seoul'[\s\S]*p\.target_date/i);
  assert.match(migration,/wr\.completed_at is null[\s\S]*wr\.journal_date = p\.target_date/i);
});

test("open work uses due date first and journal date only when no due date exists",()=>{
  assert.match(migration,/when wr\.due_at is not null[\s\S]*wr\.due_at at time zone 'Asia\/Seoul'[\s\S]*else wr\.journal_date/i);
  assert.match(migration,/wr\.status in \('in_progress', 'waiting', 'needs_review'\)/i);
});

test("journal includes Notes regardless of briefing acknowledgement but excludes cancelled records",()=>{
  assert.match(migration,/wr\.action_kind = 'note'/i);
  assert.match(migration,/wr\.status <> 'cancelled'/i);
  assert.match(migration,/wr\.journal_date = p\.target_date/i);
  assert.doesNotMatch(migration,/note_rows[\s\S]{0,700}briefing_state = 'active'/i);
});

test("Schedule source WorkRecords are excluded from completed/open task sections",()=>{
  const exclusions=migration.match(/linked_schedule\.metadata ->> 'workRecordId' = wr\.id::text/g) || [];
  assert.ok(exclusions.length>=2);
  assert.match(migration,/metadata #>> '\{actionEngine,kind\}'\) is distinct from 'schedule'/i);
});

test("journal endpoint validates bearer and date before querying Data Core",()=>{
  assert.match(endpoint,/if\(!accessToken\) return json\(401/);
  assert.match(endpoint,/if\(!\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(date\)\) return json\(400/);
  assert.match(endpoint,/createWorklogJournalReader\(\{client\}\)\.load\(date\)/);
  assert.match(endpoint,/path:"\/api\/work-journal"/);
});
