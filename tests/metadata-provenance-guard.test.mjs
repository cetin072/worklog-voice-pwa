import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createWorklogDataCoreAdapter } from "../netlify/shared/worklog-data-core-adapter.mjs";

const migration = fs.readFileSync(new URL("../supabase/migrations/20260916182000_metadata_provenance_search_guard.sql", import.meta.url), "utf8");
const inferenceGuard = fs.readFileSync(new URL("../public/inference-guard.js", import.meta.url), "utf8");

function baseRecord(overrides = {}) {
  return {
    clientRequestId: "req-20260916-provenance-01",
    transcript: "노무사 자료 정리해야 함",
    cleanTranscript: "노무사 자료 정리해야 함",
    institution: "태장",
    status: "진행중",
    type: "할 일",
    recordedAt: "2026-09-16T17:00:00+09:00",
    ...overrides,
  };
}

function rpcClient(calls) {
  return {
    insert: async () => { throw new Error("unused"); },
    upsert: async () => { throw new Error("unused"); },
    rpc: async (name, body) => {
      calls.push({ name, body });
      return [{
        user_id: "11111111-1111-4111-8111-111111111111",
        workspace_id: "22222222-2222-4222-8222-222222222222",
        work_record_id: "33333333-3333-4333-8333-333333333333",
        source_ref_id: "44444444-4444-4444-8444-444444444444",
      }];
    },
  };
}

test("unverified automatic institution is not persisted by the Data Core adapter", async () => {
  const calls = [];
  await createWorklogDataCoreAdapter({ client: rpcClient(calls) }).persistFast(baseRecord());
  assert.equal(calls[0].body.p_institution, null);
  assert.equal(calls[0].body.p_metadata.fieldProvenance.institution, "unverified");
});

test("explicitly user-selected institution remains eligible for persistence", async () => {
  const calls = [];
  await createWorklogDataCoreAdapter({ client: rpcClient(calls) }).persistFast(baseRecord({ institutionSource: "user_selected" }));
  assert.equal(calls[0].body.p_institution, "태장");
  assert.equal(calls[0].body.p_metadata.fieldProvenance.institution, "user_selected");
});

test("client guard prevents legacy inference from becoming confirmed institution metadata", () => {
  assert.match(inferenceGuard, /el\.id==="institution" \|\| el\.dataset\.userTouched==="1"/);
  assert.match(inferenceGuard, /payload\.institution=userSelected \? String\(payload\.institution \|\| ""\)\.trim\(\) : ""/);
  assert.match(inferenceGuard, /payload\.institutionSource=userSelected \? "user_selected" : "unverified"/);
});

test("server save RPC accepts institution only with user-selected or user-confirmed provenance", () => {
  assert.match(migration, /v_requested_institution_source[\s\S]*fieldProvenance,institution/);
  assert.match(migration, /v_institution_source in \('user_selected', 'user_confirmed'\)/);
  assert.match(migration, /then nullif\(btrim\(coalesce\(p_institution, ''\)\), ''\)[\s\S]*else null/);
  assert.match(migration, /'fieldProvenance'[\s\S]*'institution', v_institution_source/);
  assert.match(migration, /security invoker/i);
});

test("search uses confirmed metadata only and hides unverified institution labels", () => {
  assert.match(migration, /trusted_institution/);
  assert.match(migration, /trusted_structured_text/);
  assert.match(migration, /trusted_aliases/);
  assert.match(migration, /in \('user_selected', 'user_confirmed'\)/);
  assert.match(migration, /nullif\(r\.trusted_institution, ''\) as institution/);
  assert.doesNotMatch(migration, /lower\(btrim\(coalesce\(wr\.institution, ''\)\)\) = p\.q_lower/);
  assert.match(migration, /revoke all on function public\.search_my_work_records[\s\S]*from public, anon/i);
});
