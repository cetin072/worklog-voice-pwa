import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createWorklogDataCoreBriefingStatus } from "../netlify/shared/worklog-data-core-briefing-status.mjs";

const migration = fs.readFileSync(new URL("../supabase/migrations/20260916003500_briefing_status_fast_path.sql", import.meta.url), "utf8");
const briefingFunction = fs.readFileSync(new URL("../netlify/functions/briefing-v2.mts", import.meta.url), "utf8");

const recordId = "11111111-1111-4111-8111-111111111111";

test("briefing status fast writer uses exactly one authenticated RPC", async () => {
  const calls = [];
  const writer = createWorklogDataCoreBriefingStatus({
    client: {
      update: async () => { throw new Error("legacy update must not be called"); },
      async rpc(name, body) {
        calls.push({ name, body });
        return [{ record_id: recordId, status_value: "completed" }];
      },
    },
  });

  const result = await writer.updateStatusFast({ recordId, status: "완료" });
  assert.deepEqual(calls, [{ name: "update_my_work_record_status", body: { p_record_id: recordId, p_status: "completed" } }]);
  assert.deepEqual(result, { recordId, status: "완료" });
});

test("briefing status fast writer keeps existing validation and fail-closed ownership result", async () => {
  const writer = createWorklogDataCoreBriefingStatus({ client: { update: async () => [], rpc: async () => [] } });
  await assert.rejects(() => writer.updateStatusFast({ recordId: "bad-id", status: "완료" }), (error) => error?.code === "WORKLOG_DATA_CORE_STATUS_RECORD_ID_INVALID");
  await assert.rejects(() => writer.updateStatusFast({ recordId, status: "삭제" }), (error) => error?.code === "WORKLOG_DATA_CORE_STATUS_INVALID");
  await assert.rejects(() => writer.updateStatusFast({ recordId, status: "완료" }), (error) => error?.code === "WORKLOG_DATA_CORE_STATUS_NOT_FOUND_OR_FORBIDDEN");
});

test("status RPC is security-invoker, authenticated-only, and creator scoped", () => {
  assert.match(migration, /create or replace function public\.update_my_work_record_status\(/i);
  assert.match(migration, /security invoker/i);
  assert.doesNotMatch(migration, /security definer/i);
  assert.match(migration, /v_user_id uuid := \(select auth\.uid\(\)\)/i);
  assert.match(migration, /wr\.created_by_user_id = v_user_id/i);
  assert.match(migration, /wr\.workspace_id = v_workspace_id/i);
  assert.match(migration, /revoke all on function public\.update_my_work_record_status\(uuid, text\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.update_my_work_record_status\(uuid, text\) to authenticated, service_role/i);
});

test("briefing POST attempts fast status RPC before legacy workspace resolver and exposes diagnostic", () => {
  const fastIndex = briefingFunction.indexOf("result=await statusWriter.updateStatusFast");
  const resolverIndex = briefingFunction.indexOf("workspaceContext=await resolver.resolve(accessToken)", fastIndex);
  assert.ok(fastIndex >= 0, "fast status call must exist");
  assert.ok(resolverIndex > fastIndex, "legacy workspace resolver must only run after fast status attempt");
  assert.match(briefingFunction, /dataCoreFastPath:fastPath/);
  assert.match(briefingFunction, /statusFastRpcUnavailable/);
});
