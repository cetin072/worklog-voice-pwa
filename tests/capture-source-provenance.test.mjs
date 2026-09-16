import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createWorklogDataCoreAdapter } from "../netlify/shared/worklog-data-core-adapter.mjs";

const migration = fs.readFileSync(new URL("../supabase/migrations/20260916193000_capture_source_provenance.sql", import.meta.url), "utf8");
const capture = fs.readFileSync(new URL("../public/capture.js", import.meta.url), "utf8");
const home = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

function captureRecord(overrides = {}) {
  return {
    clientRequestId: "capture-1234567890abcdef",
    transcript: "내일 오후 2시에 삼현 미팅",
    cleanTranscript: "삼현 미팅",
    institution: "기타",
    institutionSource: "unverified",
    status: "진행중",
    type: "회의·통화",
    recordedAt: "2026-09-16T10:00:00+09:00",
    dueStart: "2026-09-17T14:00:00+09:00",
    ...overrides,
  };
}

function rpcClient(calls) {
  return {
    insert: async () => { throw new Error("insert must not be called"); },
    upsert: async () => { throw new Error("upsert must not be called"); },
    async rpc(name, body) {
      calls.push({ name, body });
      return [{
        user_id: "11111111-1111-1111-1111-111111111111",
        workspace_id: "22222222-2222-2222-2222-222222222222",
        work_record_id: "33333333-3333-3333-3333-333333333333",
        source_ref_id: "44444444-4444-4444-4444-444444444444",
        schedule_id: "55555555-5555-5555-5555-555555555555",
      }];
    },
  };
}

test("capture request namespace survives the existing /api/worklog record boundary", async () => {
  const calls = [];
  await createWorklogDataCoreAdapter({ client: rpcClient(calls) }).persistFast(captureRecord());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "save_my_worklog_with_schedule");
  assert.equal(calls[0].body.p_metadata.sourceType, "capture");
  assert.equal(calls[0].body.p_metadata.source, "capture");
});

test("explicit capture sourceType also stays capture", async () => {
  const calls = [];
  await createWorklogDataCoreAdapter({ client: rpcClient(calls) }).persistFast(captureRecord({ sourceType: "capture" }));
  assert.equal(calls[0].body.p_metadata.sourceType, "capture");
});

test("ordinary worklog request namespace remains direct", async () => {
  const calls = [];
  await createWorklogDataCoreAdapter({ client: rpcClient(calls) }).persistFast(captureRecord({
    clientRequestId: "req-20260916-1234567890",
    sourceType: undefined,
  }));
  assert.equal(calls[0].body.p_metadata.sourceType, "direct");
  assert.equal(calls[0].body.p_metadata.source, "quick_worklog");
});

test("canonical SQL preserves capture SourceRef and capture Schedule provenance", () => {
  assert.match(migration, /v_source_type text := case[\s\S]*= 'capture' then 'capture'/);
  assert.match(migration, /insert into public\.source_refs[\s\S]*v_source_type/);
  assert.match(migration, /'source', v_source_label, 'sourceType', v_source_type/);
  assert.match(migration, /from public\.save_my_worklog\(/);
  assert.match(migration, /security invoker/);
  assert.doesNotMatch(migration, /security definer/i);
});

test("capture client declares capture source and home exposes a secondary capture entry", () => {
  assert.match(capture, /sourceType:"capture"/);
  assert.match(capture, /fetch\("\/api\/worklog"/);
  assert.match(home, /id="captureOpen"[^>]*href="\/capture\.html"/);
});
