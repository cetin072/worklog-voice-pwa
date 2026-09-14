import assert from "node:assert/strict";
import test from "node:test";
import {
  createDataCoreRepositories,
  toCandidateRow,
  toScheduleRow,
  toSourceRefRow,
  toWorkRecordRow,
} from "../netlify/shared/data-core/repositories.mjs";
import { createSupabaseDataCoreRestClient } from "../netlify/shared/data-core/supabase-rest-client.mjs";
import { createSupabaseWorkspaceContextResolver } from "../netlify/shared/platform/supabase-workspace-context.mjs";
import { createWorklogDataCoreBriefingReader } from "../netlify/shared/worklog-data-core-briefing-reader.mjs";
import { createWorklogDataCoreBriefingStatus } from "../netlify/shared/worklog-data-core-briefing-status.mjs";

const workspaceContext = { userId: "user-1", workspaceId: "workspace-1", role: "owner" };

test("WorkRecord repository row는 Workspace/creator 소유권과 Data Core field를 명시한다", () => {
  const row = toWorkRecordRow({
    title: "계약서 확인", content: "본문", originalText: "음성 원문", recordType: "task", status: "waiting",
    institution: "태장", amount: 12000, followUp: "오후에 연락", recordedAt: "2026-09-14T00:00:00.000Z", dueAt: "2026-09-15T00:00:00.000Z",
  }, workspaceContext);
  assert.deepEqual(row, {
    workspace_id: "workspace-1", created_by_user_id: "user-1", client_request_id: null, assigned_user_id: null,
    title: "계약서 확인", content: "본문", original_text: "음성 원문", record_type: "task", status: "waiting",
    institution: "태장", amount: 12000, follow_up: "오후에 연락", recorded_at: "2026-09-14T00:00:00.000Z", due_at: "2026-09-15T00:00:00.000Z", metadata: {},
  });
  assert.throws(() => toWorkRecordRow({ title: "x", recordedAt: "today" }, workspaceContext), (error) => error?.code === "DATA_CORE_WORK_RECORD_RECORDED_AT_INVALID");
});

test("Schedule은 끝 시각 역전과 Workspace Context 누락을 차단한다", () => {
  assert.throws(() => toScheduleRow({ title: "미팅", startsAt: "2026-09-14T11:00:00Z", endsAt: "2026-09-14T10:00:00Z" }, workspaceContext), (error) => error?.code === "DATA_CORE_SCHEDULE_ENDS_AT_INVALID");
  assert.throws(() => toScheduleRow({ title: "미팅", startsAt: "2026-09-14T11:00:00Z" }, {}), (error) => error?.code === "WORKSPACE_CONTEXT_USER_REQUIRED");
  assert.throws(() => toScheduleRow({ title: "미팅", startsAt: "2026-09-14T11:00:00Z", allDay: "yes" }, workspaceContext), (error) => error?.code === "DATA_CORE_SCHEDULE_ALL_DAY_INVALID");
});

test("SourceRef와 Candidate는 확인 가능한 출처/확정 대상만 저장한다", () => {
  const source = toSourceRefRow({ entityType: "work_record", entityId: "record-1", sourceType: "voice", sourceId: "request-1" }, workspaceContext);
  assert.equal(source.workspace_id, "workspace-1");
  assert.equal(source.client_request_id, null);
  assert.throws(() => toCandidateRow({ candidateType: "schedule", status: "confirmed", payload: {} }, workspaceContext), (error) => error?.code === "DATA_CORE_CANDIDATE_CONFIRMATION_REQUIRED");
  const candidate = toCandidateRow({ candidateType: "schedule", status: "confirmed", payload: {}, confirmedAt: "2026-09-14T00:00:00Z", confirmedEntityType: "schedule", confirmedEntityId: "schedule-1" }, workspaceContext);
  assert.equal(candidate.confirmed_entity_id, "schedule-1");
  assert.throws(() => toCandidateRow({ candidateType: "task", confidence: 1.1, payload: {} }, workspaceContext), (error) => error?.code === "DATA_CORE_CANDIDATE_CONFIDENCE_INVALID");
});

test("Repository는 domain code가 table REST shape를 다루지 않도록 insert client에 위임한다", async () => {
  const calls = [];
  const repositories = createDataCoreRepositories({ insert: async (table, row) => { calls.push({ table, row }); return { id: "record-1" }; } });
  const saved = await repositories.workRecords.create({ title: "업무", recordedAt: "2026-09-14T00:00:00Z" }, workspaceContext);
  assert.deepEqual(saved, { id: "record-1" });
  assert.equal(calls[0].table, "work_records");
  assert.equal(calls[0].row.workspace_id, "workspace-1");
});

test("Supabase REST adapter는 publishable key와 사용자 JWT만 사용하고 실패를 전달한다", async () => {
  const requests = [];
  const client = createSupabaseDataCoreRestClient({
    supabaseUrl: "https://worklog-platform.supabase.co", publishableKey: "sb_publishable_example", accessToken: "user-jwt",
    fetchImpl: async (url, init) => { requests.push({ url, init }); return { ok: true, json: async () => [{ id: "record-1" }] }; },
  });
  assert.deepEqual(await client.insert("work_records", { title: "업무" }), { id: "record-1" });
  assert.equal(requests[0].init.headers.authorization, "Bearer user-jwt");
  assert.equal(requests[0].init.headers.apikey, "sb_publishable_example");
  assert.deepEqual(await client.upsert("work_records", { title: "업무" }, ["workspace_id", "client_request_id"]), { id: "record-1" });
  assert.match(requests[1].url, /on_conflict=workspace_id%2Cclient_request_id/);
  assert.deepEqual(await client.select("work_records", { select: "id,title", workspace_id: "eq.workspace-1" }), [{ id: "record-1" }]);
  assert.match(requests[2].url, /workspace_id=eq\.workspace-1/);
  assert.deepEqual(await client.update("work_records", { status: "completed" }, { id: "eq.record-1", workspace_id: "eq.workspace-1" }), [{ id: "record-1" }]);
  assert.equal(requests[3].init.method, "PATCH");
  assert.match(requests[3].url, /workspace_id=eq\.workspace-1/);
  await assert.rejects(() => client.update("work_records", { status: "completed" }), (error) => error?.code === "SUPABASE_DATA_CORE_UPDATE_INVALID");
  await assert.rejects(
    () => createSupabaseDataCoreRestClient({ supabaseUrl: "https://worklog-platform.supabase.co", publishableKey: "key", accessToken: "jwt", fetchImpl: async () => ({ ok: false, json: async () => ({ message: "RLS denied" }) }) }).insert("work_records", {}),
    (error) => error?.code === "SUPABASE_DATA_CORE_INSERT_FAILED",
  );
});

test("Workspace resolver는 사용자 JWT로 본인과 Personal Workspace를 함께 확인한다", async () => {
  const requests = [];
  const resolver = createSupabaseWorkspaceContextResolver({
    supabaseUrl: "https://worklog-platform.supabase.co", publishableKey: "sb_publishable_example",
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return { ok: true, json: async () => url.includes("/auth/v1/user") ? { id: "user-1" } : [{ workspace_id: "workspace-1" }] };
    },
  });
  assert.deepEqual(await resolver.resolve("user-jwt"), { userId: "user-1", workspaceId: "workspace-1", role: "owner" });
  assert.equal(requests[0].init.headers.authorization, "Bearer user-jwt");
  assert.equal(requests[1].init.method, "POST");
  assert.equal(requests[1].init.headers.apikey, "sb_publishable_example");
});

test("Data Core Briefing reader는 현재 Workspace의 열린 WorkRecord만 V2 task로 매핑한다", async () => {
  const calls = [];
  const reader = createWorklogDataCoreBriefingReader({
    client: { select: async (table, query) => {
      calls.push({ table, query });
      return [{ id: "record-1", title: "계약서 확인", institution: "태장", status: "needs_review", follow_up: "오후 회신", due_at: "2026-09-15T00:00:00+09:00", updated_at: "2026-09-14T01:00:00Z", metadata: {} }];
    } },
  });
  assert.deepEqual(await reader.listOpenTasks(workspaceContext), [{ pageId: "record-1", title: "계약서 확인", institution: "태장", status: "확인필요", project: "", dueKey: "2026-09-15", followUp: "오후 회신", editedAt: "2026-09-14T01:00:00Z" }]);
  assert.equal(calls[0].table, "work_records");
  assert.equal(calls[0].query.workspace_id, "eq.workspace-1");
  assert.equal(calls[0].query.status, "in.(in_progress,waiting,needs_review)");
});

test("Data Core Briefing 상태 변경은 Workspace 조건으로 본인 WorkRecord 한 건만 갱신한다", async () => {
  const calls = [];
  const recordId = "11111111-1111-4111-8111-111111111111";
  const writer = createWorklogDataCoreBriefingStatus({
    client: { update: async (table, row, query) => {
      calls.push({ table, row, query });
      return [{ id: recordId, status: "completed" }];
    } },
  });
  assert.deepEqual(await writer.updateStatus({ recordId, status: "완료" }, workspaceContext), { recordId, status: "완료" });
  assert.equal(calls[0].table, "work_records");
  assert.deepEqual(calls[0].row, { status: "completed" });
  assert.deepEqual(calls[0].query, { id: `eq.${recordId}`, workspace_id: "eq.workspace-1" });
  await assert.rejects(() => writer.updateStatus({ recordId: "record-1", status: "완료" }, workspaceContext), (error) => error?.code === "WORKLOG_DATA_CORE_STATUS_RECORD_ID_INVALID");
  await assert.rejects(() => writer.updateStatus({ recordId, status: "삭제" }, workspaceContext), (error) => error?.code === "WORKLOG_DATA_CORE_STATUS_INVALID");
});

test("Data Core Briefing 상태 변경은 반환 행이 없으면 권한 없음 또는 미존재로 처리한다", async () => {
  const recordId = "22222222-2222-4222-8222-222222222222";
  const writer = createWorklogDataCoreBriefingStatus({ client: { update: async () => [] } });
  await assert.rejects(() => writer.updateStatus({ recordId, status: "진행중" }, workspaceContext), (error) => error?.code === "WORKLOG_DATA_CORE_STATUS_NOT_FOUND_OR_FORBIDDEN");
});
