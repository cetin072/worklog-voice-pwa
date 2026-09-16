import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createWorklogDataCoreAdapter } from "../netlify/shared/worklog-data-core-adapter.mjs";

const migration = fs.readFileSync(new URL("../supabase/migrations/20260916002000_worklog_save_fast_path.sql", import.meta.url), "utf8");
const worklogFunction = fs.readFileSync(new URL("../netlify/functions/worklog.mts", import.meta.url), "utf8");

function record(overrides = {}) {
  return {
    clientRequestId: "req-20260916-1234567890",
    transcript: "태장 대표 보고 내일까지 확인",
    cleanTranscript: "태장 대표 보고 확인",
    institution: "태장",
    status: "대기",
    type: "할 일",
    recordedAt: "2026-09-16T09:00:00+09:00",
    amount: "12000",
    followUp: "회신 확인",
    dueStart: "2026-09-17",
    ...overrides,
  };
}

test("worklog fast adapter persists WorkRecord + SourceRef with exactly one RPC", async () => {
  const calls = [];
  const client = {
    insert: async () => { throw new Error("insert must not be called"); },
    upsert: async () => { throw new Error("upsert must not be called"); },
    async rpc(name, body) {
      calls.push({ name, body });
      return [{
        user_id: "11111111-1111-1111-1111-111111111111",
        workspace_id: "22222222-2222-2222-2222-222222222222",
        work_record_id: "33333333-3333-3333-3333-333333333333",
        source_ref_id: "44444444-4444-4444-4444-444444444444",
      }];
    },
  };

  const result = await createWorklogDataCoreAdapter({ client }).persistFast(record());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "save_my_worklog");
  assert.equal(calls[0].body.p_client_request_id, "req-20260916-1234567890");
  assert.equal(calls[0].body.p_record_type, "task");
  assert.equal(calls[0].body.p_status, "waiting");
  assert.equal(calls[0].body.p_amount, 12000);
  assert.equal(calls[0].body.p_due_at, "2026-09-17T00:00:00+09:00");
  assert.equal(result.fastPath, true);
  assert.equal(result.workRecordId, "33333333-3333-3333-3333-333333333333");
  assert.equal(result.sourceRefId, "44444444-4444-4444-4444-444444444444");
});

test("worklog fast adapter fails closed on malformed RPC response", async () => {
  const client = { insert: async () => ({}), upsert: async () => ({}), rpc: async () => [] };
  await assert.rejects(
    () => createWorklogDataCoreAdapter({ client }).persistFast(record()),
    (error) => error?.code === "WORKLOG_DATA_CORE_FAST_WORKSPACE_MISSING"
  );
});

test("save_my_worklog RPC keeps RLS active and authenticated-only", () => {
  assert.match(migration, /create or replace function public\.save_my_worklog\(/i);
  assert.match(migration, /security invoker/i);
  assert.doesNotMatch(migration, /security definer/i);
  assert.match(migration, /v_user_id uuid := \(select auth\.uid\(\)\)/i);
  assert.match(migration, /revoke all on function public\.save_my_worklog[\s\S]*from public, anon/i);
  assert.match(migration, /grant execute on function public\.save_my_worklog[\s\S]*to authenticated, service_role/i);
});

test("save_my_worklog RPC upserts both rows through named idempotency constraints", () => {
  assert.match(migration, /insert into public\.work_records/i);
  assert.match(migration, /on conflict on constraint work_records_workspace_client_request_id_key/i);
  assert.match(migration, /insert into public\.source_refs/i);
  assert.match(migration, /on conflict on constraint source_refs_workspace_client_request_id_key/i);
  assert.match(migration, /v_work_record_id::text/);
});

test("Data Core primary save attempts fast RPC before legacy workspace resolver", () => {
  const fastIndex = worklogFunction.indexOf("fastDataCore=await dataCore.persistFast(record)");
  const fallbackIndex = worklogFunction.indexOf("workspaceContext=await resolver.resolve(accessToken)", fastIndex);
  assert.ok(fastIndex >= 0, "fast save call must exist");
  assert.ok(fallbackIndex > fastIndex, "legacy resolver must only appear after fast save attempt");
  assert.match(worklogFunction, /dataCoreFastPath:fastPath/);
  assert.match(worklogFunction, /fastSaveRpcUnavailable/);
});
