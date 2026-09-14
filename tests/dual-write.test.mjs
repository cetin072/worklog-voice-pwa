import assert from "node:assert/strict";
import test from "node:test";
import { createDualWriteCoordinator } from "../netlify/shared/dual-write-coordinator.mjs";
import { createWorklogDataCoreAdapter } from "../netlify/shared/worklog-data-core-adapter.mjs";

const requestId = "request-20260914-abcdef";
const workspaceContext = { userId: "user-1", workspaceId: "workspace-1", role: "owner" };

test("Dual-write는 부분 성공을 보존하고 재시도에서 완료되지 않은 writer만 실행한다", async () => {
  const calls = []; const snapshots = [];
  const coordinator = createDualWriteCoordinator({
    writeDataCore: async () => { calls.push("data"); return { workRecordId: "record-1" }; },
    writeNotion: async () => { calls.push("notion"); throw Object.assign(new Error("Notion down"), { code: "NOTION_DOWN" }); },
    saveProgress: async (progress) => snapshots.push({ ...progress }),
  });
  const first = await coordinator.execute({});
  assert.equal(first.complete, false); assert.deepEqual(calls, ["data", "notion"]); assert.equal(first.failures[0].target, "notion");
  const retry = createDualWriteCoordinator({ writeDataCore: async () => { throw new Error("must not run"); }, writeNotion: async () => ({ pageId: "page-1" }) });
  const second = await retry.execute({}, { dataCore: snapshots[0].dataCore });
  assert.equal(second.complete, true); assert.equal(second.notion.pageId, "page-1");
});

test("Dual-write는 양쪽 실패만 호출자 오류로 만들며 성공 데이터를 숨기지 않는다", async () => {
  const coordinator = createDualWriteCoordinator({ writeDataCore: async () => { throw new Error("db"); }, writeNotion: async () => { throw new Error("notion"); } });
  await assert.rejects(() => coordinator.execute({}), (error) => error?.code === "DUAL_WRITE_ALL_FAILED" && error?.failures.length === 2);
});

test("Worklog Data Core adapter는 request ID로 WorkRecord와 SourceRef upsert를 연결한다", async () => {
  const calls = [];
  const adapter = createWorklogDataCoreAdapter({ client: { insert: async () => ({}), upsert: async (table, row, conflict) => { calls.push({ table, row, conflict }); return table === "work_records" ? { id: "record-1" } : { id: "source-1" }; } } });
  const saved = await adapter.persist({ clientRequestId: requestId, transcript: "원문", cleanTranscript: "계약서 확인", type: "할 일", status: "대기", recordedAt: "2026-09-14T00:00:00Z", dueStart: "2026-09-15" }, workspaceContext);
  assert.deepEqual(saved, { workRecordId: "record-1", sourceRefId: "source-1", workspaceId: "workspace-1" });
  assert.deepEqual(calls.map((call) => call.conflict), [["workspace_id", "client_request_id"], ["workspace_id", "client_request_id"]]);
  assert.equal(calls[1].row.entity_id, "record-1");
  assert.equal(calls[1].row.client_request_id, requestId);
});
