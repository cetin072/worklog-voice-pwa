import assert from "node:assert/strict";
import test from "node:test";
import { createWorklogPrimarySave } from "../netlify/shared/worklog-primary-save.mjs";

test("Data Core primary 저장은 Notion 미설정이어도 완료되며 checkpoint를 남긴다", async () => {
  const snapshots = [];
  const primary = createWorklogPrimarySave({
    writeDataCore: async () => ({ workRecordId: "record-1" }),
    saveProgress: async (progress) => snapshots.push({ ...progress }),
  });
  const result = await primary.execute({});
  assert.equal(result.notionSync, "not_configured");
  assert.equal(result.dataCore.workRecordId, "record-1");
  assert.deepEqual(snapshots, [{ dataCore: { workRecordId: "record-1" }, notion: null }]);
});

test("Data Core primary 저장은 Notion 실패를 pending으로 보존하고 재시도에서 Data Core를 다시 쓰지 않는다", async () => {
  const snapshots = [];
  const first = createWorklogPrimarySave({
    writeDataCore: async () => ({ workRecordId: "record-1" }),
    writeNotion: async () => { throw Object.assign(new Error("Notion down"), { code: "NOTION_DOWN" }); },
    saveProgress: async (progress) => snapshots.push({ ...progress }),
  });
  const pending = await first.execute({});
  assert.equal(pending.notionSync, "pending");
  assert.equal(pending.notionErrorCode, "NOTION_DOWN");

  const retry = createWorklogPrimarySave({
    writeDataCore: async () => { throw new Error("Data Core must not run"); },
    writeNotion: async () => ({ pageId: "page-1", url: "https://notion.so/page-1" }),
  });
  const completed = await retry.execute({}, snapshots[0]);
  assert.equal(completed.notionSync, "synced");
  assert.equal(completed.notion.pageId, "page-1");
});

test("Data Core primary 저장 실패는 선택 Notion writer를 호출하지 않는다", async () => {
  let notionCalled = false;
  const primary = createWorklogPrimarySave({
    writeDataCore: async () => { throw Object.assign(new Error("RLS"), { code: "RLS_DENIED" }); },
    writeNotion: async () => { notionCalled = true; return { pageId: "page-1" }; },
  });
  await assert.rejects(() => primary.execute({}), (error) => error?.code === "RLS_DENIED");
  assert.equal(notionCalled, false);
});
