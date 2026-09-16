import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  dictionaryFromWorkspaceMetadata,
  normalizeWorkRecord,
  RECORD_NORMALIZATION_VERSION,
} from "../netlify/shared/record-normalization.mjs";
import {
  createRecordNormalizationPlatformJob,
  createRecordNormalizationRetryPlan,
  runRecordNormalizationProcessing,
} from "../netlify/shared/record-normalization-processing.mjs";
import { planRecordNormalizationBackfill } from "../netlify/shared/record-normalization-backfill.mjs";
import { createWorklogDataCoreAdapter } from "../netlify/shared/worklog-data-core-adapter.mjs";

const migration=fs.readFileSync(new URL("../supabase/migrations/20260916155500_work_record_normalization_v1.sql",import.meta.url),"utf8");
const worker=fs.readFileSync(new URL("../netlify/functions/record-normalize.mts",import.meta.url),"utf8");
const worklog=fs.readFileSync(new URL("../netlify/functions/worklog.mts",import.meta.url),"utf8");

const workspaceContext={
  userId:"11111111-1111-4111-8111-111111111111",
  workspaceId:"22222222-2222-4222-8222-222222222222",
  role:"owner",
};

function record(overrides={}){
  return {
    id:"33333333-3333-4333-8333-333333333333",
    client_request_id:"req-20260916-normalize-01",
    title:"사면 견적 이야기",
    content:"사면 견적 이야기하기로 했어",
    original_text:"내일 오후 두시에 사면에서 견적 이야기하기로 했어",
    institution:"기타",
    status:"waiting",
    record_type:"task",
    follow_up:null,
    due_at:"2026-09-17T14:00:00+09:00",
    ...overrides,
  };
}

test("trusted institution dictionary canonicalizes normalized text/structure while preserving raw",()=>{
  const source=record();
  const rawBefore=source.original_text;
  const dictionary=dictionaryFromWorkspaceMetadata({
    normalization_dictionary:[{
      entityType:"institution",
      canonical:"삼현",
      aliases:["사면","삼연"],
      confidence:0.99,
      autoReplace:true,
    }],
  });
  const result=normalizeWorkRecord(source,{dictionary});
  assert.equal(source.original_text,rawBefore);
  assert.equal(result.normalizedText,"삼현 견적 이야기하기로 했어");
  assert.equal(result.normalizedTitle,"삼현 견적 이야기");
  assert.equal(result.structuredData.institution,"삼현");
  assert.equal(result.structuredData.dueAt,"2026-09-17T14:00:00+09:00");
  assert.ok(result.searchAliases.includes("삼현"));
  assert.ok(result.searchAliases.includes("사면"));
  assert.equal(result.reviewState,"unreviewed");
});

test("person dictionary never auto-replaces names even when requested",()=>{
  const dictionary=dictionaryFromWorkspaceMetadata({
    normalization_dictionary:[{
      entityType:"person",
      canonical:"박 과장",
      aliases:["박과장"],
      confidence:1,
      autoReplace:true,
    }],
  });
  const result=normalizeWorkRecord(record({content:"박과장 견적 확인",original_text:"박과장 견적 확인"}),{dictionary});
  assert.equal(result.normalizedText,"박과장 견적 확인");
  assert.equal(result.reviewState,"needs_review");
  assert.ok(result.searchAliases.includes("박 과장"));
  assert.ok(result.searchAliases.includes("박과장"));
});

test("missing original uses fallback content and requires review",()=>{
  const result=normalizeWorkRecord(record({original_text:"",content:"기존 이관 기록"}));
  assert.equal(result.sourceQuality,"fallback_content");
  assert.equal(result.reviewState,"needs_review");
  assert.ok(result.confidence<0.8);
});

test("dictionary keys containing digits are rejected from replacement aliases",()=>{
  assert.throws(
    ()=>dictionaryFromWorkspaceMetadata({normalization_dictionary:[{entityType:"institution",canonical:"업체123",aliases:["업체124"],autoReplace:true}]}),
    error=>error?.code==="RECORD_NORMALIZATION_DICTIONARY_CANONICAL_REQUIRED",
  );
});

test("record normalization Processing Job resumes from normalization checkpoint",async()=>{
  let normalizeCalls=0;
  let persistCalls=0;
  const saved=[];
  const job=createRecordNormalizationPlatformJob({
    requestId:"req-20260916-normalize-01",
    workRecordId:"33333333-3333-4333-8333-333333333333",
    workspaceContext,
  });
  const first=await runRecordNormalizationProcessing({
    job,
    workspaceContext,
    handlers:{
      normalizing:async()=>{ normalizeCalls+=1; return {checkpoint:{normalizedTitle:"삼현 견적"}}; },
      persisting:async()=>{
        persistCalls+=1;
        const error=new Error("temporary database error");
        error.code="SUPABASE_DATA_CORE_UPDATE_FAILED";
        throw error;
      },
    },
  },{saveJob:async value=>saved.push(value)});
  assert.equal(first.ok,false);
  assert.equal(first.stage,"persisting");
  assert.equal(normalizeCalls,1);
  assert.equal(persistCalls,1);
  assert.deepEqual(first.job.checkpoints.normalized,{normalizedTitle:"삼현 견적"});
  const retry=createRecordNormalizationRetryPlan(first.job,new Date("2026-09-16T07:00:00Z"));
  assert.equal(retry.status,"scheduled");

  const second=await runRecordNormalizationProcessing({
    job:first.job,
    workspaceContext,
    handlers:{
      normalizing:async()=>{ normalizeCalls+=1; return {checkpoint:{normalizedTitle:"잘못된 재실행"}}; },
      persisting:async()=>{ persistCalls+=1; return {checkpoint:true}; },
    },
  },{saveJob:async value=>saved.push(value)});
  assert.equal(second.ok,true);
  assert.equal(normalizeCalls,1,"completed normalization checkpoint must not run twice");
  assert.equal(persistCalls,2);
  assert.equal(second.job.status,"completed");
});

test("backfill planner is bounded, idempotent and flags missing raw source",()=>{
  const records=[
    record({id:"a"}),
    record({id:"b",original_text:"",content:"이관 내용"}),
    record({id:"c"}),
  ];
  const normalizations=[
    {work_record_id:"a",processing_status:"completed",review_state:"unreviewed",normalization_version:RECORD_NORMALIZATION_VERSION,confidence:0.95},
    {work_record_id:"c",processing_status:"failed",review_state:"unreviewed",normalization_version:RECORD_NORMALIZATION_VERSION,confidence:0.95},
  ];
  const plan=planRecordNormalizationBackfill(records,normalizations,{limit:2});
  assert.equal(plan.dryRun,true);
  assert.equal(plan.count,2);
  assert.deepEqual(plan.items.map(item=>item.workRecordId),["b","c"]);
  assert.equal(plan.items[0].sourceQuality,"fallback_content");
  assert.equal(plan.items[0].requiresReview,true);
});

test("schema keeps normalization derived data separate and RLS protected",()=>{
  assert.match(migration,/create table public\.work_record_normalizations/i);
  assert.match(migration,/work_record_id uuid primary key references public\.work_records\(id\)/i);
  assert.match(migration,/search_aliases text\[\]/i);
  assert.match(migration,/using gin\(search_aliases\)/i);
  assert.match(migration,/enable row level security/i);
  assert.match(migration,/created_by_user_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration,/after insert on public\.work_records/i);
  assert.doesNotMatch(migration,/update public\.work_records[\s\S]*original_text/i);
});

test("worker is a Netlify Background Function and worklog queues it after Data Core save",()=>{
  assert.match(worker,/background:true/);
  assert.match(worker,/path:"\/api\/record-normalize"/);
  assert.match(worker,/runRecordNormalizationProcessing/);
  assert.match(worker,/dictionaryFromWorkspaceMetadata/);
  assert.doesNotMatch(worker,/client\.update\("work_records"/);
  assert.match(worklog,/const result=await primary\.execute/);
  assert.match(worklog,/queueRecordNormalization\(req,accessToken,result\.dataCore\.workRecordId\)/);
  assert.match(worklog,/normalizationQueued/);
});

test("Data Core adapter preserves date+time due_at values",async()=>{
  const calls=[];
  const client={
    insert:async()=>{throw new Error("unused");},
    upsert:async()=>{throw new Error("unused");},
    rpc:async(name,body)=>{
      calls.push({name,body});
      return [{
        user_id:"11111111-1111-4111-8111-111111111111",
        workspace_id:"22222222-2222-4222-8222-222222222222",
        work_record_id:"33333333-3333-4333-8333-333333333333",
        source_ref_id:"44444444-4444-4444-8444-444444444444",
      }];
    },
  };
  await createWorklogDataCoreAdapter({client}).persistFast({
    clientRequestId:"req-20260916-due-time-01",
    transcript:"내일 오후 2시에 삼현 견적 확인",
    cleanTranscript:"삼현 견적 확인",
    institution:"삼현",
    status:"대기",
    type:"할 일",
    recordedAt:"2026-09-16T09:00:00+09:00",
    dueStart:"2026-09-17T14:00:00+09:00",
  });
  assert.equal(calls[0].body.p_due_at,"2026-09-17T14:00:00+09:00");
});
