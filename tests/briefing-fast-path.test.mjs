import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createWorklogDataCoreBriefingSource } from "../netlify/shared/worklog-data-core-briefing-source.mjs";

const migration = fs.readFileSync(new URL("../supabase/migrations/20260916000807_briefing_fast_path.sql", import.meta.url), "utf8");
const fastFunction = fs.readFileSync(new URL("../netlify/functions/briefing-fast.mts", import.meta.url), "utf8");
const loader = fs.readFileSync(new URL("../public/briefing-legacy-loader.js", import.meta.url), "utf8");
const authUi = fs.readFileSync(new URL("../public/platform-auth-ui.js", import.meta.url), "utf8");

test("briefing source reader uses exactly one RPC and preserves task/schedule contract", async () => {
  const calls = [];
  const client = {
    async rpc(name, body) {
      calls.push({ name, body });
      return [{
        workspace_id: "11111111-1111-1111-1111-111111111111",
        today: "2026-09-16",
        tasks: [{
          id: "22222222-2222-2222-2222-222222222222",
          title: "대표 보고",
          institution: "태장",
          status: "waiting",
          follow_up: "회신 확인",
          due_at: "2026-09-17T00:00:00+09:00",
          next_attention_at: "2026-09-16T08:00:00+09:00",
          action_kind: "task",
          updated_at: "2026-09-16T08:00:00+09:00",
          metadata: { project: "운영" },
        }],
        schedules: [{
          id: "33333333-3333-3333-3333-333333333333",
          title: "오전 미팅",
          starts_at: "2026-09-16T10:00:00+09:00",
          all_day: false,
          status: "confirmed",
          location: "회의실",
        }],
      }];
    },
  };

  const source = await createWorklogDataCoreBriefingSource({ client }).load();
  assert.deepEqual(calls, [{ name: "get_my_briefing_source", body: {} }]);
  assert.equal(source.today, "2026-09-16");
  assert.equal(source.tasks.length, 1);
  assert.equal(source.tasks[0].status, "대기");
  assert.equal(source.tasks[0].project, "운영");
  assert.equal(source.tasks[0].nextAttentionAt, "2026-09-16T08:00:00+09:00");
  assert.equal(source.tasks[0].actionKind, "task");
  assert.equal(source.schedules.total, 1);
  assert.equal(source.schedules.today[0].status, "확정");
  assert.equal(source.schedules.today[0].startsAt, "2026-09-16T10:00:00+09:00");
});

test("briefing source reader fails closed when personal workspace is missing", async () => {
  const client = { rpc: async () => [] };
  await assert.rejects(
    () => createWorklogDataCoreBriefingSource({ client }).load(),
    (error) => error?.code === "WORKLOG_DATA_CORE_BRIEFING_WORKSPACE_MISSING"
  );
});

test("briefing RPC is security-invoker, auth-scoped, and not public", () => {
  assert.match(migration, /create or replace function public\.get_my_briefing_source\(\)/);
  assert.match(migration, /security invoker/i);
  assert.doesNotMatch(migration, /security definer/i);
  assert.match(migration, /owner_user_id\s*=\s*\(select auth\.uid\(\)\)/i);
  assert.match(migration, /revoke all on function public\.get_my_briefing_source\(\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.get_my_briefing_source\(\) to authenticated, service_role/i);
});

test("briefing open-work query has a partial workspace/update index", () => {
  assert.match(migration, /work_records_open_workspace_updated_at_idx/);
  assert.match(migration, /on public\.work_records \(workspace_id, updated_at desc\)/i);
  assert.match(migration, /where status in \('in_progress', 'waiting', 'needs_review'\)/i);
});

test("fast endpoint prefers one-RPC source and keeps rollout fallback", () => {
  assert.match(fastFunction, /createWorklogDataCoreBriefingSource/);
  assert.match(fastFunction, /source\.fastPath/);
  assert.match(fastFunction, /selectResurfaceTasks\(source\.tasks/);
  assert.match(fastFunction, /rpcUnavailable\(error\)/);
  assert.match(fastFunction, /loadLegacyDataCore/);
  assert.match(fastFunction, /path:"\/api\/briefing-fast"/);
});

test("client routing uses fast endpoint only for signed-in GET and keeps SWR snapshot", () => {
  assert.match(loader, /details\.method === "GET"/);
  assert.match(loader, /details\.url\.pathname === "\/api\/briefing-v2"/);
  assert.match(loader, /new URL\("\/api\/briefing-fast"/);
  assert.match(loader, /worklogBriefingV2SnapshotV1:/);
  assert.match(loader, /worklogBriefingV2DataV1:/);
  assert.match(loader, /저장된 브리핑 · 업데이트 중/);
  assert.match(loader, /저장된 브리핑 · 최신화 실패/);
  assert.match(loader, /cachedBriefingResponse\(\)/);
  assert.match(loader, /let bridgeAttached = false/);
  assert.match(loader, /if \(bridgeAttached\) return/);
  assert.match(loader, /CACHE_MAX_AGE_MS = 36 \* 60 \* 60 \* 1000/);
  assert.match(loader, /clearCurrentSnapshot\(\)/);
});

test("page auth refresh no longer bootstraps personal workspace on every load", () => {
  assert.doesNotMatch(authUi, /bootstrapPersonalWorkspace/);
  assert.match(authUi, /currentUser\(\)/);
});
